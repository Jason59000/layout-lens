import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CDPConnection } from "../cdp/connection.js";
import { LayoutExtractor } from "../cdp/extractor.js";
import type { LayoutNode, LayoutTree } from "../types.js";
import { RuleTracer } from "../diagnostics/rule-tracer.js";
import { formatPropertyTrace } from "../formatter/text.js";
import { walkTree } from "../types.js";

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

export function registerTraceProperty(server: McpServer): void {
  server.tool(
    "trace_property",
    "Trace the CSS cascade for a specific property on an element. Shows which rules set the value, their specificity, and source locations. Useful for understanding why a property has its computed value.",
    {
      selector: z.string().describe("CSS selector to find the element"),
      property: z.string().describe("CSS property to trace (e.g. 'min-width', 'z-index', 'display')"),
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

        const node = findNodeBySelector(tree, params.selector);
        if (!node) {
          return {
            content: [{ type: "text", text: `Element not found: "${params.selector}". Try a different selector.` }],
            isError: true,
          };
        }

        const tracer = new RuleTracer();
        const cascade = tracer.tracePropertyCascade(node, params.property);
        const text = formatPropertyTrace(node, params.property, cascade);

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
