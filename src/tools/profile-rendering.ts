import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CDPConnection } from "../cdp/connection.js";

interface FrameData {
  frameCount: number;
  duration: number;
  intervals: number[];
}

interface Distribution {
  veryFast: number;
  normal: number;
  slow: number;
  janky: number;
  severe: number;
}

function classifyIntervals(intervals: number[]): Distribution {
  const dist: Distribution = { veryFast: 0, normal: 0, slow: 0, janky: 0, severe: 0 };
  for (const ms of intervals) {
    if (ms < 8) dist.veryFast++;
    else if (ms <= 16) dist.normal++;
    else if (ms <= 33) dist.slow++;
    else if (ms <= 50) dist.janky++;
    else dist.severe++;
  }
  return dist;
}

function formatProfile(data: FrameData): string {
  const durationSec = data.duration / 1000;
  const avgFps = Math.round(data.frameCount / durationSec);
  const intervals = data.intervals;

  const jankThreshold = 16.67;
  const dropThreshold = 33;

  const jankFrames = intervals.filter(i => i > jankThreshold).length;
  const droppedFrames = intervals.filter(i => i > dropThreshold).length;
  const longestFrame = intervals.length > 0 ? Math.max(...intervals) : 0;

  let longestFrameAt = 0;
  if (intervals.length > 0) {
    let elapsed = 0;
    for (const interval of intervals) {
      elapsed += interval;
      if (interval === longestFrame) {
        longestFrameAt = elapsed;
        break;
      }
    }
  }

  const dist = classifyIntervals(intervals);
  const totalIntervals = intervals.length || 1;

  const lines: string[] = [];
  lines.push(`RENDERING PROFILE: ${durationSec.toFixed(1)}s capture`);
  lines.push("");
  lines.push(`FPS: avg ${avgFps}fps (target: 60fps)`);
  lines.push(`TOTAL FRAMES: ${data.frameCount}`);
  lines.push(`JANK FRAMES: ${jankFrames}/${data.frameCount} (${((jankFrames / totalIntervals) * 100).toFixed(1)}%) — frames exceeding 16.67ms`);
  lines.push(`LONGEST FRAME: ${Math.round(longestFrame)}ms (at ~${(longestFrameAt / 1000).toFixed(1)}s mark)`);
  lines.push(`DROPPED FRAMES: ~${droppedFrames} (intervals > 33ms)`);
  lines.push("");
  lines.push("FRAME TIME DISTRIBUTION:");
  lines.push(`  <8ms:    ${dist.veryFast} frames (${((dist.veryFast / totalIntervals) * 100).toFixed(1)}%) — very fast`);
  lines.push(`  8-16ms:  ${dist.normal} frames (${((dist.normal / totalIntervals) * 100).toFixed(1)}%) — normal (60fps)`);
  lines.push(`  16-33ms: ${dist.slow} frames (${((dist.slow / totalIntervals) * 100).toFixed(1)}%) — slow (30-60fps)`);
  lines.push(`  33-50ms: ${dist.janky} frames (${((dist.janky / totalIntervals) * 100).toFixed(1)}%) — janky`);
  lines.push(`  >50ms:   ${dist.severe} frame${dist.severe !== 1 ? "s" : ""} (${((dist.severe / totalIntervals) * 100).toFixed(1)}%) — severe jank`);
  lines.push("");

  if (avgFps >= 55 && jankFrames / totalIntervals < 0.05) {
    lines.push("VERDICT: smooth rendering, no issues detected");
  } else if (avgFps >= 50 && jankFrames / totalIntervals < 0.1) {
    lines.push("VERDICT: mostly smooth, occasional jank");
  } else if (avgFps >= 30) {
    lines.push("VERDICT: noticeable jank, investigate heavy frames");
  } else {
    lines.push("VERDICT: severe performance issues, rendering is not keeping up");
  }

  return lines.join("\n");
}

export function registerProfileRendering(server: McpServer): void {
  server.tool(
    "profile_rendering",
    `Measure frame timing and rendering performance using requestAnimationFrame. Reports FPS, jank frames, frame time distribution, and dropped frames over a capture period.

Use to diagnose animation stuttering, scroll jank, or general rendering performance issues.`,
    {
      port: z.number().optional().describe("Chrome debugging port (default: 9222)"),
      host: z.string().optional().describe("Chrome debugging host (default: localhost)"),
      duration: z.number().optional().describe("Capture duration in ms (default: 3000, max: 10000)"),
    },
    async (params) => {
      let connection: CDPConnection | undefined;
      try {
        const durationMs = Math.min(params.duration ?? 3000, 10000);
        connection = await CDPConnection.connect({
          host: params.host,
          port: params.port,
        });
        const client = connection.client;

        const expression = `new Promise(resolve => {
  var frames = [];
  var start = performance.now();
  var duration = ${durationMs};
  function tick(ts) {
    frames.push(ts);
    if (ts - start < duration) {
      requestAnimationFrame(tick);
    } else {
      var intervals = [];
      for (var i = 1; i < frames.length; i++) {
        intervals.push(frames[i] - frames[i-1]);
      }
      resolve(JSON.stringify({
        frameCount: frames.length,
        duration: ts - start,
        intervals: intervals
      }));
    }
  }
  requestAnimationFrame(tick);
})`;

        const result = await client.Runtime.evaluate({
          expression,
          awaitPromise: true,
          returnByValue: true,
          timeout: durationMs + 5000,
        });

        if (result.exceptionDetails) {
          const errText = result.exceptionDetails.text ?? "Unknown evaluation error";
          return {
            content: [{ type: "text", text: `ERROR: Frame timing script failed: ${errText}` }],
            isError: true,
          };
        }

        const raw = result.result.value as string;
        const data: FrameData = JSON.parse(raw);
        const text = formatProfile(data);

        return {
          content: [{ type: "text", text }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `ERROR: ${message}` }],
          isError: true,
        };
      } finally {
        if (connection) {
          await connection.disconnect();
        }
      }
    },
  );
}
