import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CDPConnection } from "../cdp/connection.js";

export function registerWatchStyles(server: McpServer): void {
  server.tool(
    "watch_styles",
    `Watch for actual computed style changes on elements over a time period. Uses CSS.trackComputedStyleUpdates — tracks real style changes (transitions, animations, media queries, JS mutations), not just DOM mutations.

Much more precise than watch_dom_mutations for layout debugging: tells you exactly which elements' computed styles changed and how often.

Examples: watch width/height changes during resize, track transform changes during animation, detect opacity transitions.`,
    {
      properties: z.array(z.string()).describe("CSS properties to watch (e.g. ['width', 'height', 'transform', 'opacity'])"),
      duration: z.number().optional().describe("Watch duration in ms (default: 3000, max: 10000)"),
      port: z.number().optional().describe("Chrome debugging port (default: 9222)"),
      host: z.string().optional().describe("Chrome debugging host (default: localhost)"),
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
        await client.DOM.enable();
        await client.CSS.enable();

        const propertiesToTrack = params.properties.map(p => ({ name: p }));

        const updates: Array<{ nodeId: number; timestamp: number }> = [];

        (client.CSS as any).computedStyleUpdated((params: { nodeId: number }) => {
          updates.push({ nodeId: params.nodeId, timestamp: Date.now() });
        });

        await (client.CSS as any).trackComputedStyleUpdates({
          propertiesToTrack,
        });

        await new Promise(r => setTimeout(r, durationMs));

        await (client.CSS as any).trackComputedStyleUpdates({
          propertiesToTrack: [],
        });

        const lines: string[] = [];
        lines.push(`COMPUTED STYLE WATCH: ${(durationMs / 1000).toFixed(1)}s`);
        lines.push(`properties: ${params.properties.join(", ")}`);
        lines.push(`total updates: ${updates.length}`);
        lines.push("");

        if (updates.length === 0) {
          lines.push("No computed style changes detected during observation period.");
        } else {
          const byNode = new Map<number, number>();
          for (const u of updates) {
            byNode.set(u.nodeId, (byNode.get(u.nodeId) ?? 0) + 1);
          }

          const sorted = [...byNode.entries()].sort((a, b) => b[1] - a[1]);

          lines.push(`ELEMENTS WITH CHANGES: ${sorted.length}`);
          lines.push("");

          for (const [nodeId, count] of sorted.slice(0, 20)) {
            let selector = `node:${nodeId}`;
            try {
              const { node } = await client.DOM.describeNode({ nodeId });
              selector = node.localName || node.nodeName.toLowerCase();
              const attrs = node.attributes || [];
              for (let i = 0; i < attrs.length; i += 2) {
                if (attrs[i] === "id") selector += `#${attrs[i + 1]}`;
                if (attrs[i] === "class") {
                  const cls = attrs[i + 1].split(/\s+/).filter(Boolean);
                  if (cls.length > 0) selector += `.${cls[0]}`;
                }
              }
            } catch {
              // node description is best-effort
            }
            lines.push(`  ${selector}: ${count} change(s)`);
          }

          if (sorted.length > 20) {
            lines.push(`  ... and ${sorted.length - 20} more elements`);
          }

          const firstUpdate = updates[0].timestamp;
          const lastUpdate = updates[updates.length - 1].timestamp;
          const span = lastUpdate - firstUpdate;
          if (span > 0) {
            lines.push("");
            lines.push(`TIMING: changes spread over ${span}ms`);
            const rate = updates.length / (span / 1000);
            lines.push(`  rate: ~${Math.round(rate)} updates/sec`);
          }
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("trackComputedStyleUpdates")) {
          return {
            content: [{ type: "text", text: "ERROR: CSS.trackComputedStyleUpdates not available in this Chrome version. Requires Chrome 110+." }],
            isError: true,
          };
        }
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
