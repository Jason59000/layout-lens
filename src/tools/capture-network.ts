import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CDPConnection } from "../cdp/connection.js";

interface RequestEntry {
  requestId: string;
  url: string;
  method: string;
  type?: string;
  status?: number;
  statusText?: string;
  mimeType?: string;
  size?: number;
  timing?: number;
  failed?: string;
}

export function registerCaptureNetwork(server: McpServer): void {
  server.tool(
    "capture_network",
    `Capture network requests over a time period. Uses the Network domain to see every fetch, XHR, script, stylesheet, and image request — including failures, CORS errors, and slow responses.

Use to diagnose: empty components (failed API call), missing images (404), CORS blocks, slow page loads, or any issue where the page didn't get the data it expected.`,
    {
      duration: z.number().optional().describe("Capture duration in ms (default: 5000, max: 15000)"),
      port: z.number().optional().describe("Chrome debugging port (default: 9222)"),
      host: z.string().optional().describe("Chrome debugging host (default: localhost)"),
    },
    async (params) => {
      let connection: CDPConnection | undefined;
      try {
        const durationMs = Math.min(params.duration ?? 5000, 15000);

        connection = await CDPConnection.connect({
          host: params.host,
          port: params.port,
        });

        const client = connection.client;
        await client.Network.enable({});

        const requests = new Map<string, RequestEntry>();

        client.Network.requestWillBeSent((event) => {
          requests.set(event.requestId, {
            requestId: event.requestId,
            url: event.request.url,
            method: event.request.method,
            type: event.type,
          });
        });

        client.Network.responseReceived((event) => {
          const entry = requests.get(event.requestId);
          if (entry) {
            entry.status = event.response.status;
            entry.statusText = event.response.statusText;
            entry.mimeType = event.response.mimeType;
            if (event.response.timing) {
              entry.timing = Math.round(event.response.timing.receiveHeadersEnd);
            }
          }
        });

        client.Network.loadingFinished((event) => {
          const entry = requests.get(event.requestId);
          if (entry) {
            entry.size = event.encodedDataLength;
          }
        });

        client.Network.loadingFailed((event) => {
          const entry = requests.get(event.requestId);
          if (entry) {
            entry.failed = event.errorText;
            if (event.blockedReason) {
              entry.failed += ` (${event.blockedReason})`;
            }
          }
        });

        await new Promise(r => setTimeout(r, durationMs));

        await client.Network.disable();

        const all = [...requests.values()];
        const lines: string[] = [];
        lines.push(`NETWORK CAPTURE: ${(durationMs / 1000).toFixed(1)}s`);
        lines.push(`total requests: ${all.length}`);
        lines.push("");

        const failed = all.filter(r => r.failed);
        const errors = all.filter(r => r.status && r.status >= 400);
        const successful = all.filter(r => r.status && r.status < 400 && !r.failed);

        if (failed.length > 0) {
          lines.push(`FAILED REQUESTS: ${failed.length}`);
          for (const r of failed) {
            const url = shortenUrl(r.url);
            lines.push(`  ${r.method} ${url}`);
            lines.push(`    error: ${r.failed}`);
            if (r.type) lines.push(`    type: ${r.type}`);
          }
          lines.push("");
        }

        if (errors.length > 0) {
          lines.push(`ERROR RESPONSES: ${errors.length}`);
          for (const r of errors) {
            const url = shortenUrl(r.url);
            lines.push(`  ${r.method} ${url} → ${r.status} ${r.statusText || ""}`);
            if (r.type) lines.push(`    type: ${r.type}`);
          }
          lines.push("");
        }

        if (all.length === 0) {
          lines.push("No network requests during observation period.");
        } else {
          const byType = new Map<string, number>();
          for (const r of all) {
            const type = r.type || "Other";
            byType.set(type, (byType.get(type) ?? 0) + 1);
          }

          lines.push("BY TYPE:");
          for (const [type, count] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
            lines.push(`  ${type}: ${count}`);
          }
          lines.push("");

          const totalSize = all.reduce((sum, r) => sum + (r.size ?? 0), 0);
          lines.push(`TOTAL TRANSFER: ${formatBytes(totalSize)}`);

          const withTiming = all.filter(r => r.timing !== undefined && r.timing > 0);
          if (withTiming.length > 0) {
            const slowest = withTiming.sort((a, b) => (b.timing ?? 0) - (a.timing ?? 0)).slice(0, 5);
            lines.push("");
            lines.push("SLOWEST REQUESTS:");
            for (const r of slowest) {
              const url = shortenUrl(r.url);
              lines.push(`  ${r.timing}ms ${r.method} ${url} → ${r.status || "pending"}`);
            }
          }

          lines.push("");
          lines.push("ALL REQUESTS:");
          const maxShow = 30;
          const toShow = all.slice(0, maxShow);
          for (const r of toShow) {
            const url = shortenUrl(r.url);
            const status = r.failed ? `FAILED: ${r.failed}` : r.status ? `${r.status}` : "pending";
            const size = r.size !== undefined ? ` ${formatBytes(r.size)}` : "";
            const timing = r.timing ? ` ${r.timing}ms` : "";
            lines.push(`  ${r.method} ${url} → ${status}${size}${timing}`);
          }
          if (all.length > maxShow) {
            lines.push(`  ... and ${all.length - maxShow} more requests`);
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

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname + u.search;
    if (path.length > 80) return path.slice(0, 77) + "...";
    return path;
  } catch {
    if (url.length > 80) return url.slice(0, 77) + "...";
    return url;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
