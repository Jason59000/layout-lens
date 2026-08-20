import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CDPConnection } from "../cdp/connection.js";

interface ConsoleEntry {
  type: string;
  text: string;
  timestamp: number;
  url?: string;
  line?: number;
}

export function registerCaptureConsole(server: McpServer): void {
  server.tool(
    "capture_console",
    `Capture console output (log, warn, error) and uncaught exceptions over a time period. Uses Runtime.consoleAPICalled and Runtime.exceptionThrown — sees everything that appears in Chrome's console tab.

Use to diagnose: blank components (JS crash), missing data (failed fetch logged), React errors, deprecation warnings, or any runtime issue invisible from layout alone.`,
    {
      duration: z.number().optional().describe("Capture duration in ms (default: 3000, max: 10000)"),
      types: z.array(z.string()).optional().describe("Filter by type: log, warn, error, info, debug (default: all)"),
      port: z.number().optional().describe("Chrome debugging port (default: 9222)"),
      host: z.string().optional().describe("Chrome debugging host (default: localhost)"),
    },
    async (params) => {
      let connection: CDPConnection | undefined;
      try {
        const durationMs = Math.min(params.duration ?? 3000, 10000);
        const typeFilter = params.types ? new Set(params.types) : null;

        connection = await CDPConnection.connect({
          host: params.host,
          port: params.port,
        });

        const client = connection.client;
        await client.Runtime.enable();

        const entries: ConsoleEntry[] = [];

        client.Runtime.consoleAPICalled((event) => {
          const type = event.type;
          if (typeFilter && !typeFilter.has(type)) return;

          const args = event.args || [];
          const parts: string[] = [];
          for (const arg of args) {
            if (arg.value !== undefined) {
              parts.push(typeof arg.value === "string" ? arg.value : JSON.stringify(arg.value));
            } else if (arg.description) {
              parts.push(arg.description);
            } else if (arg.unserializableValue) {
              parts.push(arg.unserializableValue);
            } else {
              parts.push(`[${arg.type}]`);
            }
          }

          const entry: ConsoleEntry = {
            type,
            text: parts.join(" "),
            timestamp: event.timestamp,
          };

          if (event.stackTrace && event.stackTrace.callFrames.length > 0) {
            const frame = event.stackTrace.callFrames[0];
            if (frame.url) entry.url = frame.url;
            if (frame.lineNumber !== undefined) entry.line = frame.lineNumber + 1;
          }

          entries.push(entry);
        });

        const exceptions: Array<{ text: string; url?: string; line?: number; timestamp: number }> = [];

        client.Runtime.exceptionThrown((event) => {
          const detail = event.exceptionDetails;
          let text = detail.text;
          if (detail.exception) {
            text = detail.exception.description || detail.exception.value || text;
          }

          const entry: { text: string; url?: string; line?: number; timestamp: number } = {
            text: typeof text === "string" ? text : String(text),
            timestamp: event.timestamp,
          };

          if (detail.url) entry.url = detail.url;
          if (detail.lineNumber !== undefined) entry.line = detail.lineNumber + 1;

          exceptions.push(entry);
        });

        await new Promise(r => setTimeout(r, durationMs));

        const lines: string[] = [];
        lines.push(`CONSOLE CAPTURE: ${(durationMs / 1000).toFixed(1)}s`);
        lines.push(`entries: ${entries.length}, exceptions: ${exceptions.length}`);
        lines.push("");

        if (exceptions.length > 0) {
          lines.push(`EXCEPTIONS: ${exceptions.length}`);
          for (const ex of exceptions) {
            const loc = ex.url ? ` (${ex.url.split("/").pop()}${ex.line ? `:${ex.line}` : ""})` : "";
            const text = ex.text.length > 500 ? ex.text.slice(0, 500) + "..." : ex.text;
            lines.push(`  ${text}${loc}`);
          }
          lines.push("");
        }

        if (entries.length === 0 && exceptions.length === 0) {
          lines.push("No console output during observation period.");
        } else if (entries.length > 0) {
          const byType = new Map<string, number>();
          for (const e of entries) {
            byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
          }

          lines.push("BY TYPE:");
          for (const [type, count] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
            lines.push(`  ${type}: ${count}`);
          }
          lines.push("");

          lines.push("ENTRIES:");
          const maxEntries = 50;
          const toShow = entries.slice(0, maxEntries);
          for (const e of toShow) {
            const loc = e.url ? ` (${e.url.split("/").pop()}${e.line ? `:${e.line}` : ""})` : "";
            const text = e.text.length > 300 ? e.text.slice(0, 300) + "..." : e.text;
            lines.push(`  [${e.type}] ${text}${loc}`);
          }
          if (entries.length > maxEntries) {
            lines.push(`  ... and ${entries.length - maxEntries} more entries`);
          }
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
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
