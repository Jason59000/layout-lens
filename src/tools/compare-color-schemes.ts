import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CDPConnection } from "../cdp/connection.js";
import { LayoutExtractor } from "../cdp/extractor.js";
import type { LayoutNode } from "../types.js";

function flattenTree(node: LayoutNode): LayoutNode[] {
  const result: LayoutNode[] = [node];
  for (const child of node.children) {
    result.push(...flattenTree(child));
  }
  return result;
}

function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const toLinear = (c: number) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function rgbaToHex(rgba: string): string | null {
  const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return null;
  const r = parseInt(match[1], 10);
  const g = parseInt(match[2], 10);
  const b = parseInt(match[3], 10);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function isTransparent(color: string): boolean {
  return color === "rgba(0, 0, 0, 0)" || color === "transparent";
}

interface ColorSchemeIssue {
  type: "low-contrast" | "unchanged" | "size-changed";
  selector: string;
  details: string;
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

export function registerCompareColorSchemes(server: McpServer): void {
  server.tool(
    "compare_color_schemes",
    `Compare light and dark mode rendering of the page. Takes screenshots in both modes and analyzes color differences.

Detects:
- Elements with hardcoded colors that don't respond to color scheme changes
- Low contrast text in either mode (below 4.5:1 ratio)
- Elements that changed size/position between modes

Returns two screenshots (light + dark) and a text summary of issues found.`,
    {
      selectors: z.array(z.string()).optional().describe("Only compare these CSS selectors instead of all elements"),
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
        const extractor = new LayoutExtractor(connection);

        // Light mode pass
        await client.Emulation.setEmulatedMedia({
          features: [{ name: "prefers-color-scheme", value: "light" }],
        });
        await new Promise(r => setTimeout(r, 200));

        const lightTree = await extractor.extractTree({ lightweight: true });
        const lightScreenshot = await client.Page.captureScreenshot({
          format: "png",
          captureBeyondViewport: false,
        });

        // Dark mode pass
        await client.Emulation.setEmulatedMedia({
          features: [{ name: "prefers-color-scheme", value: "dark" }],
        });
        await new Promise(r => setTimeout(r, 200));

        const darkTree = await extractor.extractTree({ lightweight: true });
        const darkScreenshot = await client.Page.captureScreenshot({
          format: "png",
          captureBeyondViewport: false,
        });

        // Compare
        const lightNodes = flattenTree(lightTree.root);
        const darkNodes = flattenTree(darkTree.root);

        const darkNodeMap = new Map<number, LayoutNode>();
        for (const node of darkNodes) {
          darkNodeMap.set(node.nodeId, node);
        }

        let filteredLightNodes = lightNodes;
        if (params.selectors && params.selectors.length > 0) {
          filteredLightNodes = lightNodes.filter(n =>
            params.selectors!.some(sel => matchSelector(n, sel)),
          );
        }

        const issues: ColorSchemeIssue[] = [];
        let comparedCount = 0;
        let respondingCount = 0;

        for (const lightNode of filteredLightNodes) {
          const darkNode = darkNodeMap.get(lightNode.nodeId);
          if (!darkNode) continue;

          const lightColor = lightNode.computed.color;
          const lightBg = lightNode.computed.backgroundColor;
          const darkColor = darkNode.computed.color;
          const darkBg = darkNode.computed.backgroundColor;

          if (!lightColor && !lightBg && !darkColor && !darkBg) continue;

          comparedCount++;

          const colorsChanged =
            lightColor !== darkColor ||
            lightBg !== darkBg;

          const sizeChanged =
            Math.abs(lightNode.boxModel.total.width - darkNode.boxModel.total.width) > 1 ||
            Math.abs(lightNode.boxModel.total.height - darkNode.boxModel.total.height) > 1;

          if (colorsChanged) respondingCount++;

          // Check for unchanged colors (hardcoded)
          if (!colorsChanged && lightColor && lightBg && !isTransparent(lightBg)) {
            issues.push({
              type: "unchanged",
              selector: lightNode.selector,
              details: `light: bg=${lightBg}, text=${lightColor}\n   dark: bg=${darkBg}, text=${darkColor}  <- same! not responding to color scheme`,
            });
          }

          // Check for low contrast in dark mode
          if (darkColor && darkBg && !isTransparent(darkBg)) {
            const darkColorHex = rgbaToHex(darkColor);
            const darkBgHex = rgbaToHex(darkBg);
            if (darkColorHex && darkBgHex) {
              const ratio = contrastRatio(darkColorHex, darkBgHex);
              if (ratio < 4.5) {
                issues.push({
                  type: "low-contrast",
                  selector: darkNode.selector,
                  details: `color: ${darkColor} on background: ${darkBg}\n   contrast ratio: ~${ratio.toFixed(1)}:1 (minimum: 4.5:1)`,
                });
              }
            }
          }

          // Check for low contrast in light mode
          if (lightColor && lightBg && !isTransparent(lightBg)) {
            const lightColorHex = rgbaToHex(lightColor);
            const lightBgHex = rgbaToHex(lightBg);
            if (lightColorHex && lightBgHex) {
              const ratio = contrastRatio(lightColorHex, lightBgHex);
              if (ratio < 4.5) {
                issues.push({
                  type: "low-contrast",
                  selector: lightNode.selector,
                  details: `color: ${lightColor} on background: ${lightBg}\n   contrast ratio: ~${ratio.toFixed(1)}:1 (minimum: 4.5:1)`,
                });
              }
            }
          }

          // Check for size/position changes
          if (sizeChanged) {
            const lw = Math.round(lightNode.boxModel.total.width);
            const lh = Math.round(lightNode.boxModel.total.height);
            const dw = Math.round(darkNode.boxModel.total.width);
            const dh = Math.round(darkNode.boxModel.total.height);
            issues.push({
              type: "size-changed",
              selector: lightNode.selector,
              details: `light: ${lw}x${lh}\n   dark: ${dw}x${dh}\n   -> likely different padding/font-size in dark mode`,
            });
          }
        }

        // Format output
        const issueLabels: Record<ColorSchemeIssue["type"], string> = {
          "low-contrast": "LOW CONTRAST",
          "unchanged": "UNCHANGED COLORS (hardcoded?)",
          "size-changed": "ELEMENT SIZE CHANGED",
        };

        const modeLabel = (issue: ColorSchemeIssue): string => {
          if (issue.type === "low-contrast") {
            if (issue.details.includes("dark")) return " (dark mode)";
            return " (light mode)";
          }
          return "";
        };

        let text = "COLOR SCHEME COMPARISON\n\n";

        if (issues.length === 0) {
          text += "NO ISSUES FOUND\n\n";
        } else {
          text += `ISSUES FOUND: ${issues.length}\n\n`;
          for (let i = 0; i < issues.length; i++) {
            const issue = issues[i];
            text += `${i + 1}. ${issueLabels[issue.type]}${modeLabel(issue)}\n`;
            text += `   element: ${issue.selector}\n`;
            text += `   ${issue.details}\n\n`;
          }
        }

        text += `SUMMARY: ${comparedCount} elements compared, ${respondingCount} respond to color scheme, ${issues.length} issues`;

        const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];

        content.push({
          type: "image" as const,
          data: lightScreenshot.data,
          mimeType: "image/png",
        });

        content.push({
          type: "image" as const,
          data: darkScreenshot.data,
          mimeType: "image/png",
        });

        content.push({
          type: "text" as const,
          text,
        });

        return { content };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `ERROR: ${message}` }],
          isError: true,
        };
      } finally {
        if (connection) {
          await connection.client.Emulation.setEmulatedMedia({ features: [] }).catch(() => {});
          await connection.disconnect();
        }
      }
    },
  );
}
