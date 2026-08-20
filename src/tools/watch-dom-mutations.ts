import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CDPConnection } from "../cdp/connection.js";

type MutationType = "attribute" | "childInsert" | "childRemove";

interface MutationRecord {
  counts: Map<MutationType, number>;
  description: string | null;
}

function describeNode(localName: string, attributes?: string[]): string {
  if (!attributes || attributes.length === 0) return localName;
  let id = "";
  let className = "";
  for (let i = 0; i < attributes.length; i += 2) {
    if (attributes[i] === "id") id = attributes[i + 1];
    if (attributes[i] === "class") className = attributes[i + 1];
  }
  if (id) return `${localName}#${id}`;
  if (className) return `${localName}.${className.split(" ")[0]}`;
  return localName;
}

function detectPattern(counts: Map<MutationType, number>): string {
  const attr = counts.get("attribute") ?? 0;
  const insert = counts.get("childInsert") ?? 0;
  const remove = counts.get("childRemove") ?? 0;
  const total = attr + insert + remove;

  if (attr > 0 && insert === 0 && remove === 0) {
    return "continuous attribute updates (likely re-render loop)";
  }
  if (insert > 0 && remove > 0 && Math.min(insert, remove) / Math.max(insert, remove) > 0.5) {
    return "list items churning rapidly";
  }
  if (insert > 0 && remove === 0) {
    return "elements being appended";
  }
  if (remove > 0 && insert === 0) {
    return "elements being removed";
  }
  if (attr / total > 0.7) {
    return "mostly attribute updates with some DOM changes";
  }
  return "mixed mutation types";
}

function formatTypeCounts(counts: Map<MutationType, number>): string {
  const parts: string[] = [];
  const attr = counts.get("attribute") ?? 0;
  const insert = counts.get("childInsert") ?? 0;
  const remove = counts.get("childRemove") ?? 0;
  if (attr > 0) parts.push(`${attr} attribute`);
  if (insert > 0) parts.push(`${insert} childNode insert`);
  if (remove > 0) parts.push(`${remove} childNode remove`);
  return parts.join(", ");
}

function formatMutations(
  tracker: Map<number, MutationRecord>,
  durationMs: number,
): string {
  const durationSec = durationMs / 1000;
  const entries = [...tracker.entries()].map(([nodeId, record]) => {
    const total = [...record.counts.values()].reduce((a, b) => a + b, 0);
    return { nodeId, record, total };
  });

  const totalMutations = entries.reduce((sum, e) => sum + e.total, 0);

  if (totalMutations === 0) {
    return `DOM MUTATION MONITOR: ${durationSec.toFixed(1)}s capture\n\nNO MUTATIONS DETECTED\n\nThe DOM was completely stable during the capture period.`;
  }

  entries.sort((a, b) => b.total - a.total);

  const hot = entries.filter(e => e.total > 10);
  const moderate = entries.filter(e => e.total >= 3 && e.total <= 10);

  const lines: string[] = [];
  lines.push(`DOM MUTATION MONITOR: ${durationSec.toFixed(1)}s capture`);
  lines.push("");

  if (hot.length > 0) {
    lines.push(`HOT ELEMENTS (>10 mutations):`);
    for (let i = 0; i < hot.length; i++) {
      const { record, total } = hot[i];
      const rate = (total / durationSec).toFixed(0);
      const desc = record.description ?? "(unknown)";
      lines.push(`${i + 1}. ${desc} — ${total} mutations (${rate}/sec)`);
      lines.push(`   types: ${formatTypeCounts(record.counts)}`);
      lines.push(`   pattern: ${detectPattern(record.counts)}`);
      lines.push("");
    }
  }

  if (moderate.length > 0) {
    lines.push(`MODERATE (3-10 mutations):`);
    for (let i = 0; i < moderate.length; i++) {
      const idx = hot.length + i + 1;
      const { record, total } = moderate[i];
      const rate = (total / durationSec).toFixed(0);
      const desc = record.description ?? "(unknown)";
      lines.push(`${idx}. ${desc} — ${total} mutations (${rate}/sec)`);
      lines.push(`   types: ${formatTypeCounts(record.counts)}`);
      lines.push("");
    }
  }

  const avgRate = (totalMutations / durationSec).toFixed(0);
  lines.push(`TOTAL: ${totalMutations} DOM mutations in ${durationSec.toFixed(1)}s (${avgRate}/sec average)`);
  lines.push(`UNIQUE ELEMENTS MODIFIED: ${entries.length}`);

  return lines.join("\n");
}

export function registerWatchDomMutations(server: McpServer): void {
  server.tool(
    "watch_dom_mutations",
    `Monitor DOM mutations (insertions, removals, attribute changes) over a fixed duration. Identifies "hot" elements receiving many mutations — a sign of re-render loops, polling updates, or excessive DOM churn.

Use when investigating performance issues, unexpected re-renders, or flashing/flickering UI elements.`,
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

        await client.DOM.getDocument({ depth: -1 });

        const tracker = new Map<number, MutationRecord>();

        function getOrCreate(nodeId: number): MutationRecord {
          let record = tracker.get(nodeId);
          if (!record) {
            record = { counts: new Map(), description: null };
            tracker.set(nodeId, record);
          }
          return record;
        }

        function increment(nodeId: number, type: MutationType): void {
          const record = getOrCreate(nodeId);
          record.counts.set(type, (record.counts.get(type) ?? 0) + 1);
        }

        const onInserted = (params: { node: { nodeId: number; localName: string; attributes?: string[] }; parentNodeId: number }): void => {
          increment(params.parentNodeId, "childInsert");
          const parentRecord = getOrCreate(params.parentNodeId);
          if (!parentRecord.description) {
            client.DOM.describeNode({ nodeId: params.parentNodeId })
              .then(result => {
                parentRecord.description = describeNode(result.node.localName, result.node.attributes);
              })
              .catch(() => {});
          }
          const childRecord = getOrCreate(params.node.nodeId);
          if (!childRecord.description) {
            childRecord.description = describeNode(params.node.localName, params.node.attributes);
          }
        };

        const onRemoved = (params: { parentNodeId: number; nodeId: number }): void => {
          increment(params.parentNodeId, "childRemove");
          const parentRecord = getOrCreate(params.parentNodeId);
          if (!parentRecord.description) {
            client.DOM.describeNode({ nodeId: params.parentNodeId })
              .then(result => {
                parentRecord.description = describeNode(result.node.localName, result.node.attributes);
              })
              .catch(() => {});
          }
        };

        const onAttributeModified = (params: { nodeId: number; name: string }): void => {
          increment(params.nodeId, "attribute");
          const record = getOrCreate(params.nodeId);
          if (!record.description) {
            client.DOM.describeNode({ nodeId: params.nodeId })
              .then(result => {
                record.description = describeNode(result.node.localName, result.node.attributes);
              })
              .catch(() => {});
          }
        };

        const unsubInserted = client.DOM.childNodeInserted(onInserted);
        const unsubRemoved = client.DOM.childNodeRemoved(onRemoved);
        const unsubAttribute = client.DOM.attributeModified(onAttributeModified);

        await new Promise(resolve => setTimeout(resolve, durationMs));

        unsubInserted();
        unsubRemoved();
        unsubAttribute();

        const text = formatMutations(tracker, durationMs);

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
