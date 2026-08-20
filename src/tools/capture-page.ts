import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CDPConnection } from "../cdp/connection.js";
import { LayoutExtractor } from "../cdp/extractor.js";
import type { LayoutNode } from "../types.js";

const COLORS = [
  "rgba(255, 0, 0, 0.7)",
  "rgba(0, 120, 255, 0.7)",
  "rgba(255, 165, 0, 0.7)",
  "rgba(0, 200, 80, 0.7)",
  "rgba(180, 0, 255, 0.7)",
  "rgba(255, 0, 150, 0.7)",
  "rgba(0, 200, 200, 0.7)",
  "rgba(200, 200, 0, 0.7)",
];

function flattenTree(node: LayoutNode): LayoutNode[] {
  const result: LayoutNode[] = [node];
  for (const child of node.children) {
    result.push(...flattenTree(child));
  }
  return result;
}

function matchSelector(node: LayoutNode, selector: string): boolean {
  const sel = selector.toLowerCase();
  if (sel.startsWith("#")) return node.id === sel.slice(1);
  if (sel.startsWith(".")) return node.classes.includes(sel.slice(1));
  if (node.selector.toLowerCase() === sel) return true;
  const full = node.tag + (node.id ? `#${node.id}` : "") +
    node.classes.map((c) => `.${c}`).join("");
  return full.toLowerCase() === sel;
}

function buildLabel(node: LayoutNode, showProperties: string[]): string {
  const parts: string[] = [node.selector];
  const c = node.computed;
  const propMap: Record<string, string | undefined> = {
    zIndex: c.zIndex !== "auto" ? `z:${c.zIndex}` : undefined,
    position: c.position !== "static" ? c.position : undefined,
    overflow: (c.overflowX !== "visible" || c.overflowY !== "visible")
      ? `overflow:${c.overflowX}/${c.overflowY}` : undefined,
    display: (c.display !== "block" && c.display !== "inline") ? c.display : undefined,
    opacity: c.opacity !== "1" ? `opacity:${c.opacity}` : undefined,
    visibility: c.visibility !== "visible" ? c.visibility : undefined,
    width: `${Math.round(node.boxModel.total.width)}px`,
    height: `${Math.round(node.boxModel.total.height)}px`,
    size: `${Math.round(node.boxModel.total.width)}x${Math.round(node.boxModel.total.height)}`,
    stacking: node.stacking.createsContext ? `ctx:${node.stacking.contextReason}` : undefined,
  };

  for (const prop of showProperties) {
    const val = propMap[prop];
    if (val) parts.push(val);
  }

  if (showProperties.length === 0) {
    if (c.position !== "static") parts.push(c.position);
    if (c.zIndex !== "auto") parts.push(`z:${c.zIndex}`);
    if (c.overflowX !== "visible" || c.overflowY !== "visible") {
      parts.push(`overflow:${c.overflowX}/${c.overflowY}`);
    }
    if (node.stacking.createsContext) parts.push("ctx");
  }

  return parts.join(" | ");
}

function buildOverlayScript(
  nodes: LayoutNode[],
  selectors: string[],
  showProperties: string[],
): { script: string; annotations: Array<{ selector: string; label: string; rect: { x: number; y: number; width: number; height: number } }> } {
  const annotations: Array<{ selector: string; label: string; rect: { x: number; y: number; width: number; height: number } }> = [];
  const overlayElements: string[] = [];

  let colorIdx = 0;
  for (const sel of selectors) {
    const matched = nodes.filter(n => matchSelector(n, sel));
    const color = COLORS[colorIdx % COLORS.length];
    colorIdx++;

    for (const node of matched) {
      const rect = node.boxModel.total;
      const label = buildLabel(node, showProperties);
      annotations.push({ selector: node.selector, label, rect });

      const labelBg = color.replace("0.7", "0.9");
      overlayElements.push(`
        var b${annotations.length} = document.createElement("div");
        b${annotations.length}.style.cssText = "position:fixed;pointer-events:none;box-sizing:border-box;border:2px solid ${color};left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px;z-index:2147483647;";
        var l${annotations.length} = document.createElement("div");
        l${annotations.length}.style.cssText = "position:fixed;pointer-events:none;left:${rect.x}px;top:${Math.max(0, rect.y - 20)}px;background:${labelBg};color:#fff;font:bold 11px monospace;padding:2px 6px;white-space:nowrap;z-index:2147483647;border-radius:2px;";
        l${annotations.length}.textContent = ${JSON.stringify(label)};
        overlay.appendChild(b${annotations.length});
        overlay.appendChild(l${annotations.length});
      `);
    }
  }

  const script = `(function() {
    var overlay = document.createElement("div");
    overlay.id = "__layout_lens_overlay__";
    overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;";
    ${overlayElements.join("\n")}
    document.body.appendChild(overlay);
  })()`;

  return { script, annotations };
}

const CLEANUP_SCRIPT = `(function() {
  var el = document.getElementById("__layout_lens_overlay__");
  if (el) el.remove();
})()`;

export function registerCapturePage(server: McpServer): void {
  server.tool(
    "capture_page",
    `Take an annotated screenshot of the page. Highlights specific elements with colored boxes and labels showing their layout properties.

Without highlight selectors, returns a plain screenshot.
With highlight selectors, draws colored rectangles + property labels on the targeted elements.

Workflow: use query_layout to find suspect elements, then capture_page to visualize them.

Example: capture_page({ highlight: [".sidebar", ".modal"], showProperties: ["zIndex", "position", "overflow"] })

Available showProperties: zIndex, position, overflow, display, opacity, visibility, width, height, size, stacking`,
    {
      highlight: z.array(z.string()).optional().describe("CSS selectors to annotate (tag, #id, .class)"),
      showProperties: z.array(z.string()).optional().describe("Properties to show in labels: zIndex, position, overflow, display, opacity, visibility, width, height, size, stacking"),
      viewportWidth: z.number().optional().describe("Resize viewport width before capture (for responsive testing)"),
      viewportHeight: z.number().optional().describe("Resize viewport height before capture (for responsive testing)"),
      fullPage: z.boolean().optional().describe("Capture the full scrollable page, not just the viewport (default: false)"),
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

        if (params.viewportWidth || params.viewportHeight) {
          await client.Emulation.setDeviceMetricsOverride({
            width: params.viewportWidth ?? 0,
            height: params.viewportHeight ?? 0,
            deviceScaleFactor: 1,
            mobile: (params.viewportWidth ?? 1024) < 768,
          });
          await new Promise(r => setTimeout(r, 200));
        }

        const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
        let annotations: Array<{ selector: string; label: string; rect: { x: number; y: number; width: number; height: number } }> = [];

        if (params.highlight && params.highlight.length > 0) {
          const extractor = new LayoutExtractor(connection);
          const tree = await extractor.extractTree({ lightweight: true });
          const allNodes = flattenTree(tree.root);

          const overlay = buildOverlayScript(
            allNodes,
            params.highlight,
            params.showProperties ?? [],
          );
          annotations = overlay.annotations;

          await client.Runtime.evaluate({
            expression: overlay.script,
            timeout: 5000,
          });

          await new Promise(r => setTimeout(r, 100));
        }

        const screenshot = await client.Page.captureScreenshot({
          format: "png",
          captureBeyondViewport: params.fullPage ?? false,
        });

        if (params.highlight && params.highlight.length > 0) {
          await client.Runtime.evaluate({
            expression: CLEANUP_SCRIPT,
            timeout: 5000,
          });
        }

        content.push({
          type: "image" as const,
          data: screenshot.data,
          mimeType: "image/png",
        });

        if (params.viewportWidth || params.viewportHeight) {
          await client.Emulation.clearDeviceMetricsOverride();
        }

        if (annotations.length > 0) {
          const summary = annotations.map((a, i) =>
            `${i + 1}. ${a.label} @ (${Math.round(a.rect.x)},${Math.round(a.rect.y)}) ${Math.round(a.rect.width)}x${Math.round(a.rect.height)}`
          ).join("\n");
          content.push({
            type: "text" as const,
            text: `${annotations.length} elements highlighted:\n${summary}`,
          });
        }

        return { content };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `ERROR: ${message}` }],
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
