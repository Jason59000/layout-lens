import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CDPConnection } from "../cdp/connection.js";
import { LayoutExtractor } from "../cdp/extractor.js";
import type { LayoutNode, LayoutTree } from "../types.js";
import { formatComparison } from "../formatter/text.js";
import { walkTree } from "../detectors/types.js";

/**
 * Find a node in the tree by matching its selector.
 */
function findNodeBySelector(
  tree: LayoutTree,
  selector: string,
): LayoutNode | undefined {
  const selectorLower = selector.toLowerCase();
  let match: LayoutNode | undefined;

  walkTree(tree, (node) => {
    if (match) return;

    if (selector.startsWith("#") && node.id === selector.slice(1)) {
      match = node;
      return;
    }

    if (selector.startsWith(".")) {
      const className = selector.slice(1);
      if (node.classes.includes(className)) {
        match = node;
        return;
      }
    }

    const nodeSelector = node.tag +
      (node.id ? `#${node.id}` : "") +
      (node.classes.length > 0 ? node.classes.map((c) => `.${c}`).join("") : "");

    if (nodeSelector.toLowerCase() === selectorLower) {
      match = node;
      return;
    }

    if (node.selector.toLowerCase() === selectorLower) {
      match = node;
    }
  });

  return match;
}

export function registerCompareElements(server: McpServer): void {
  server.tool(
    "compare_elements",
    "Compare two elements side by side. Shows geometry, padding, margin, computed style differences, and stacking context differences. Useful for debugging why two similar elements look different.",
    {
      selectorA: z.string().describe("CSS selector for the first element"),
      selectorB: z.string().describe("CSS selector for the second element"),
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

        const extractor = new LayoutExtractor(connection);
        const tree = await extractor.extractTree();

        const nodeA = findNodeBySelector(tree, params.selectorA);
        if (!nodeA) {
          return {
            content: [{ type: "text", text: `Element A not found: "${params.selectorA}". Try a different selector.` }],
            isError: true,
          };
        }

        const nodeB = findNodeBySelector(tree, params.selectorB);
        if (!nodeB) {
          return {
            content: [{ type: "text", text: `Element B not found: "${params.selectorB}". Try a different selector.` }],
            isError: true,
          };
        }

        const text = formatComparison(nodeA, nodeB);

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
