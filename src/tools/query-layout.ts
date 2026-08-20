import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runInNewContext } from "node:vm";
import { CDPConnection } from "../cdp/connection.js";
import { LayoutExtractor } from "../cdp/extractor.js";
import type { LayoutNode, LayoutTree, Rect } from "../types.js";

function flattenTree(node: LayoutNode): LayoutNode[] {
  const result: LayoutNode[] = [node];
  for (const child of node.children) {
    result.push(...flattenTree(child));
  }
  return result;
}

function findBySelector(nodes: LayoutNode[], selector: string): LayoutNode[] {
  const sel = selector.toLowerCase();
  return nodes.filter((n) => {
    if (sel.startsWith("#")) return n.id === sel.slice(1);
    if (sel.startsWith(".")) return n.classes.includes(sel.slice(1));
    if (n.selector.toLowerCase() === sel) return true;
    const full = n.tag + (n.id ? `#${n.id}` : "") +
      n.classes.map((c) => `.${c}`).join("");
    return full.toLowerCase() === sel;
  });
}

function getAncestors(nodes: LayoutNode[], target: LayoutNode): LayoutNode[] {
  const result: LayoutNode[] = [];
  let current = target;
  while (current.parentId) {
    const parent = nodes.find((n) => n.nodeId === current.parentId);
    if (!parent) break;
    result.push(parent);
    current = parent;
  }
  return result;
}

function getDescendants(node: LayoutNode): LayoutNode[] {
  const result: LayoutNode[] = [];
  for (const child of node.children) {
    result.push(child);
    result.push(...getDescendants(child));
  }
  return result;
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

function formatNodeCompact(node: LayoutNode): Record<string, unknown> {
  const r: Record<string, unknown> = {
    selector: node.selector,
    tag: node.tag,
  };
  if (node.id) r.id = node.id;
  if (node.classes.length > 0) r.classes = node.classes.join(" ");

  const box = node.boxModel;
  r.rect = `${Math.round(box.total.x)},${Math.round(box.total.y)} ${Math.round(box.total.width)}x${Math.round(box.total.height)}`;

  const c = node.computed;
  if (c.display !== "block" && c.display !== "inline") r.display = c.display;
  if (c.position !== "static") r.position = c.position;
  if (c.overflowX !== "visible" || c.overflowY !== "visible") {
    r.overflow = `${c.overflowX}/${c.overflowY}`;
  }
  if (c.zIndex !== "auto") r.zIndex = c.zIndex;
  if (c.opacity !== "1") r.opacity = c.opacity;
  if (c.visibility !== "visible") r.visibility = c.visibility;
  if (node.scroll.isScrollContainer) {
    r.scroll = `${node.scroll.scrollWidth}x${node.scroll.scrollHeight} (client: ${node.scroll.clientWidth}x${node.scroll.clientHeight})`;
  }
  if (node.stacking.createsContext) r.stackingContext = node.stacking.contextReason;
  if (node.naturalSize) r.naturalSize = `${node.naturalSize.width}x${node.naturalSize.height}`;
  if (node.textContent) r.text = node.textContent;
  if (c.willChange && c.willChange !== "auto") r.willChange = c.willChange;
  if (c.transform && c.transform !== "none") r.transform = c.transform;
  if (c.color) r.color = c.color;
  if (c.backgroundColor && c.backgroundColor !== "rgba(0, 0, 0, 0)") r.bgColor = c.backgroundColor;
  if (c.fontSize) r.fontSize = c.fontSize;

  return r;
}

const MAX_RESULTS = 50;

export function registerQueryLayout(server: McpServer): void {
  server.tool(
    "query_layout",
    `Run a custom JavaScript query on the page's layout tree. The expression runs in Node.js on the extracted data (not in the browser), so it's instant.

Available variables:
- nodes: LayoutNode[] — flat array of all elements
- tree: LayoutNode — root node (html)
- viewport: {width, height}
- find(selector): LayoutNode[] — find by tag, #id, .class
- ancestors(node): LayoutNode[] — parent chain up to root
- descendants(node): LayoutNode[] — all children recursively
- intersects(a, b): boolean — do two nodes' rects overlap?

Each LayoutNode has: tag, id, classes, selector, textContent? (direct text, truncated to 200 chars), boxModel.total (x,y,width,height), boxModel.margin/padding/border (top,right,bottom,left), computed (display, position, overflow, zIndex, opacity, color, backgroundColor, fontSize, lineHeight, etc.), scroll (scrollWidth, scrollHeight, clientWidth, clientHeight, isScrollContainer), stacking (zIndex, createsContext, contextReason), naturalSize? (images).

Return value is formatted automatically. Return an array of nodes, a single node, or any JSON-serializable value.

Examples:
- "nodes.filter(n => n.computed.overflowX === 'hidden' && n.scroll.scrollWidth > n.scroll.clientWidth)"
- "nodes.filter(n => n.stacking.createsContext).map(n => ({sel: n.selector, reason: n.stacking.contextReason, z: n.computed.zIndex}))"
- "ancestors(find('.my-element')[0])"
- "nodes.filter(n => n.tag === 'img' && n.naturalSize && Math.abs(n.naturalSize.width/n.naturalSize.height - n.boxModel.total.width/n.boxModel.total.height) > 0.1)"`,
    {
      expression: z.string().describe("JavaScript expression to evaluate on the layout tree"),
      viewportWidth: z.number().optional().describe("Resize viewport width before extraction (for responsive testing)"),
      viewportHeight: z.number().optional().describe("Resize viewport height before extraction (for responsive testing)"),
      colorScheme: z.enum(["light", "dark"]).optional().describe("Emulate prefers-color-scheme media feature before extraction"),
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

        if (params.viewportWidth || params.viewportHeight) {
          await connection.client.Emulation.setDeviceMetricsOverride({
            width: params.viewportWidth ?? 0,
            height: params.viewportHeight ?? 0,
            deviceScaleFactor: 1,
            mobile: (params.viewportWidth ?? 1024) < 768,
          });
          await new Promise(r => setTimeout(r, 200));
        }

        if (params.colorScheme) {
          await connection.client.Emulation.setEmulatedMedia({
            features: [{ name: "prefers-color-scheme", value: params.colorScheme }],
          });
          await new Promise(r => setTimeout(r, 200));
        }

        const extractor = new LayoutExtractor(connection);
        const layoutTree = await extractor.extractTree({ lightweight: true });

        const allNodes = flattenTree(layoutTree.root);

        // Set up parentId references for ancestor lookups
        function setParentIds(node: LayoutNode) {
          for (const child of node.children) {
            child.parentId = node.nodeId;
            setParentIds(child);
          }
        }
        setParentIds(layoutTree.root);

        const sandbox = {
          nodes: allNodes,
          tree: layoutTree.root,
          viewport: layoutTree.viewport,
          find: (sel: string) => findBySelector(allNodes, sel),
          ancestors: (node: LayoutNode) => getAncestors(allNodes, node),
          descendants: (node: LayoutNode) => getDescendants(node),
          intersects: (a: LayoutNode, b: LayoutNode) =>
            rectsIntersect(a.boxModel.total, b.boxModel.total),
          Math, JSON, Array, Object, String, Number, Boolean,
          parseInt, parseFloat, isNaN, isFinite,
          undefined, NaN, Infinity,
        };

        const result = runInNewContext(
          `"use strict"; (${params.expression})`,
          sandbox,
          { timeout: 5000 },
        );

        const text = formatResult(result);

        if (params.viewportWidth || params.viewportHeight) {
          await connection.client.Emulation.clearDeviceMetricsOverride();
        }

        if (params.colorScheme) {
          await connection.client.Emulation.setEmulatedMedia({ features: [] });
        }

        return {
          content: [{ type: "text", text }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (connection && (params.viewportWidth || params.viewportHeight)) {
          await connection.client.Emulation.clearDeviceMetricsOverride().catch(() => {});
        }
        if (connection && params.colorScheme) {
          await connection.client.Emulation.setEmulatedMedia({ features: [] }).catch(() => {});
        }
        return {
          content: [{ type: "text", text: `QUERY ERROR: ${message}` }],
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

function formatResult(result: unknown): string {
  if (result === null || result === undefined) {
    return "No results";
  }

  if (Array.isArray(result)) {
    if (result.length === 0) return "No results (empty array)";

    // Check if array contains LayoutNodes
    if (result[0] && typeof result[0] === "object" && "nodeId" in result[0]) {
      const nodes = result.slice(0, MAX_RESULTS) as LayoutNode[];
      const lines = nodes.map((n, i) => {
        const compact = formatNodeCompact(n);
        return `${i + 1}. ${JSON.stringify(compact)}`;
      });
      let text = `${result.length} results`;
      if (result.length > MAX_RESULTS) {
        text += ` (showing first ${MAX_RESULTS})`;
      }
      return text + "\n" + lines.join("\n");
    }

    // Generic array
    const items = result.slice(0, MAX_RESULTS);
    let text = `${result.length} results`;
    if (result.length > MAX_RESULTS) {
      text += ` (showing first ${MAX_RESULTS})`;
    }
    return text + "\n" + items.map((item, i) =>
      `${i + 1}. ${JSON.stringify(item)}`
    ).join("\n");
  }

  // Single LayoutNode
  if (typeof result === "object" && result !== null && "nodeId" in result) {
    return JSON.stringify(formatNodeCompact(result as LayoutNode), null, 2);
  }

  // Any other value
  return JSON.stringify(result, null, 2);
}
