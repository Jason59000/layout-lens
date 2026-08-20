import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CDPConnection } from "../cdp/connection.js";

interface AnimationEntry {
  name: string;
  state: string;
  currentTime: number | null;
  duration: number | null;
  playbackRate: number;
  targetTag: string | null;
  targetSelector: string | null;
  targetDisplay: string | null;
  targetVisibility: string | null;
  isStuck: boolean;
  isOnHidden: boolean;
}

type AnimationCategory = "stuck" | "on-hidden" | "normal" | "paused" | "finished" | "idle" | "other";

function categorize(a: AnimationEntry): AnimationCategory {
  if (a.isStuck) return "stuck";
  if (a.isOnHidden) return "on-hidden";
  if (a.state === "running") return "normal";
  if (a.state === "paused") return "paused";
  if (a.state === "finished") return "finished";
  if (a.state === "idle") return "idle";
  return "other";
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "unknown";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatAnimationLine(a: AnimationEntry): string {
  const parts: string[] = [];
  parts.push(`animation: ${a.name}`);
  if (a.duration !== null) parts.push(formatDuration(a.duration));
  if (a.playbackRate !== 1) parts.push(`rate: ${a.playbackRate}x`);
  return parts.join(" ");
}

function formatAnimations(entries: AnimationEntry[]): string {
  if (entries.length === 0) {
    return "NO ANIMATIONS FOUND\n\nNo CSS animations or Web Animations are currently active on this page.";
  }

  const categorized = entries.map(a => ({ entry: a, category: categorize(a) }));
  const issues = categorized.filter(c => c.category === "stuck" || c.category === "on-hidden");
  const normal = categorized.filter(c => c.category === "normal");
  const informational = categorized.filter(c =>
    c.category === "paused" || c.category === "finished" || c.category === "idle" || c.category === "other"
  );

  const lines: string[] = [];
  lines.push(`ANIMATIONS: ${entries.length} found (${issues.length} issue${issues.length !== 1 ? "s" : ""})`);
  lines.push("");

  for (const { entry } of issues.filter(i => i.category === "stuck")) {
    lines.push("ISSUE: animation stuck at 0%");
    lines.push(`  element: ${entry.targetSelector ?? entry.targetTag ?? "(unknown)"}`);
    lines.push(`  ${formatAnimationLine(entry)}`);
    lines.push(`  current time: ${entry.currentTime ?? 0}ms`);
    lines.push(`  state: running → should be progressing`);
    lines.push("");
  }

  for (const { entry } of issues.filter(i => i.category === "on-hidden")) {
    lines.push("ISSUE: animation on hidden element");
    lines.push(`  element: ${entry.targetSelector ?? entry.targetTag ?? "(unknown)"}`);
    lines.push(`  ${formatAnimationLine(entry)}`);
    if (entry.targetDisplay === "none") {
      lines.push(`  display: none → animation won't play`);
    } else if (entry.targetVisibility === "hidden") {
      lines.push(`  visibility: hidden → animation won't be visible`);
    }
    lines.push("");
  }

  if (normal.length > 0) {
    lines.push(`OK: ${normal.length} animation${normal.length !== 1 ? "s" : ""} running normally`);
    for (const { entry } of normal) {
      lines.push(`  ${entry.targetSelector ?? entry.targetTag ?? "(unknown)"}: ${formatAnimationLine(entry)} (at ${formatDuration(entry.currentTime)})`);
    }
    lines.push("");
  }

  if (informational.length > 0) {
    lines.push(`INFO: ${informational.length} animation${informational.length !== 1 ? "s" : ""} not running`);
    for (const { entry, category } of informational) {
      lines.push(`  ${entry.targetSelector ?? entry.targetTag ?? "(unknown)"}: ${entry.name} — ${category}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function registerCheckAnimations(server: McpServer): void {
  server.tool(
    "check_animations",
    `Inspect all running CSS animations and Web Animations on the page. Detects two common issues:
- Stuck animations: playState is "running" but currentTime is 0 (animation not progressing)
- Hidden animations: running on display:none or visibility:hidden elements (wasted work)

Also lists all normal, paused, finished, and idle animations for a complete picture.`,
    {
      port: z.number().optional().describe("Chrome debugging port (default: 9222)"),
      host: z.string().optional().describe("Chrome debugging host (default: localhost)"),
    },
    async (params) => {
      let connection: CDPConnection | undefined;
      try {
        connection = await CDPConnection.connect({
          host: params.host,
          port: params.port,
        });
        const client = connection.client;

        const result = await client.Runtime.evaluate({
          expression: `JSON.stringify(document.getAnimations().map(a => {
  var target = a.effect && a.effect.target;
  var cs = target ? getComputedStyle(target) : null;
  return {
    name: a.animationName || a.id || '(anonymous)',
    state: a.playState,
    currentTime: a.currentTime,
    duration: a.effect ? a.effect.getComputedTiming().duration : null,
    playbackRate: a.playbackRate,
    targetTag: target ? target.tagName : null,
    targetSelector: target ? (target.id ? '#' + target.id : (target.className ? '.' + target.className.split(' ')[0] : target.tagName)) : null,
    targetDisplay: cs ? cs.display : null,
    targetVisibility: cs ? cs.visibility : null,
    isStuck: a.playState === 'running' && a.currentTime === 0,
    isOnHidden: cs && (cs.display === 'none' || cs.visibility === 'hidden')
  };
}))`,
          returnByValue: true,
        });

        const raw = result.result.value as string;
        const entries: AnimationEntry[] = JSON.parse(raw);
        const text = formatAnimations(entries);

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
