import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CDPConnection } from "../cdp/connection.js";

export function registerGetPerformanceMetrics(server: McpServer): void {
  server.tool(
    "get_performance_metrics",
    "Get runtime performance metrics from Chrome: JS heap size, DOM node count, layout count/duration, style recalculations, script duration, and task duration. Useful for diagnosing slow pages and memory leaks.",
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
        await client.Performance.enable();
        const { metrics } = await client.Performance.getMetrics();

        const metricMap = new Map<string, number>();
        for (const m of metrics) {
          metricMap.set(m.name, m.value);
        }

        const get = (name: string): number => metricMap.get(name) ?? 0;

        const lines: string[] = [];
        lines.push("PERFORMANCE METRICS");
        lines.push("");

        lines.push("MEMORY:");
        const heapUsed = get("JSHeapUsedSize");
        const heapTotal = get("JSHeapTotalSize");
        lines.push(`  JS heap used: ${(heapUsed / 1024 / 1024).toFixed(1)} MB`);
        lines.push(`  JS heap total: ${(heapTotal / 1024 / 1024).toFixed(1)} MB`);
        lines.push(`  heap utilization: ${heapTotal > 0 ? ((heapUsed / heapTotal) * 100).toFixed(0) : 0}%`);
        lines.push("");

        lines.push("DOM:");
        lines.push(`  nodes: ${get("Nodes")}`);
        lines.push(`  documents: ${get("Documents")}`);
        lines.push(`  frames: ${get("Frames")}`);
        lines.push(`  event listeners: ${get("JSEventListeners")}`);
        lines.push("");

        lines.push("LAYOUT:");
        lines.push(`  layout count: ${get("LayoutCount")}`);
        lines.push(`  layout duration: ${(get("LayoutDuration") * 1000).toFixed(1)} ms`);
        lines.push(`  recalc style count: ${get("RecalcStyleCount")}`);
        lines.push(`  recalc style duration: ${(get("RecalcStyleDuration") * 1000).toFixed(1)} ms`);
        lines.push("");

        lines.push("SCRIPT:");
        lines.push(`  script duration: ${(get("ScriptDuration") * 1000).toFixed(1)} ms`);
        lines.push(`  task duration: ${(get("TaskDuration") * 1000).toFixed(1)} ms`);
        lines.push("");

        let resourceInfo = "";
        try {
          const resResult = await client.Runtime.evaluate({
            expression: `JSON.stringify({
              timing: performance.timing ? {
                domContentLoaded: performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart,
                load: performance.timing.loadEventEnd - performance.timing.navigationStart,
                domInteractive: performance.timing.domInteractive - performance.timing.navigationStart,
                firstByte: performance.timing.responseStart - performance.timing.navigationStart
              } : null,
              resources: performance.getEntriesByType("resource").length,
              navType: performance.getEntriesByType("navigation")[0]?.type || "unknown"
            })`,
            returnByValue: true,
          });
          if (resResult.result.value) {
            const perf = JSON.parse(resResult.result.value as string);
            if (perf.timing && perf.timing.load > 0) {
              lines.push("");
              lines.push("NAVIGATION TIMING:");
              lines.push(`  first byte: ${perf.timing.firstByte} ms`);
              lines.push(`  DOM interactive: ${perf.timing.domInteractive} ms`);
              lines.push(`  DOM content loaded: ${perf.timing.domContentLoaded} ms`);
              lines.push(`  page load: ${perf.timing.load} ms`);
              lines.push(`  resources loaded: ${perf.resources}`);
              lines.push(`  navigation type: ${perf.navType}`);
            }
          }
        } catch {
          // navigation timing is best-effort
        }

        return {
          content: [{ type: "text", text: lines.join("\n") + resourceInfo }],
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
