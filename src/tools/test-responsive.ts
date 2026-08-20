import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CDPConnection } from "../cdp/connection.js";
import { LayoutExtractor } from "../cdp/extractor.js";
import type { LayoutNode, LayoutTree } from "../types.js";

const DEFAULT_BREAKPOINTS = [320, 375, 768, 1024, 1280, 1920];

const BREAKPOINT_LABELS: Record<number, string> = {
  320: "mobile S",
  375: "mobile M",
  768: "tablet",
  1024: "desktop S",
  1280: "desktop M",
  1920: "desktop L",
};

interface NodeWithPath {
  node: LayoutNode;
  path: string;
}

interface BreakpointSnapshot {
  width: number;
  label: string;
  tree: LayoutTree;
  nodesByPath: Map<string, LayoutNode>;
}

interface OverflowIssue {
  path: string;
  selector: string;
  elementWidth: number;
  viewportWidth: number;
  isScrollOverflow: boolean;
}

interface VisibilityChange {
  path: string;
  selector: string;
  hiddenAt: number[];
  visibleAt: number[];
}

interface LayoutChange {
  path: string;
  selector: string;
  property: string;
  changes: Array<{ width: number; value: string }>;
}

function flattenWithPaths(node: LayoutNode, parentPath: string = ""): NodeWithPath[] {
  const path = parentPath ? `${parentPath} > ${node.selector}` : node.selector;
  const result: NodeWithPath[] = [{ node, path }];
  for (const child of node.children) {
    result.push(...flattenWithPaths(child, path));
  }
  return result;
}

function getLabel(width: number): string {
  return BREAKPOINT_LABELS[width] ?? `${width}px`;
}

function shortPath(path: string): string {
  const parts = path.split(" > ");
  if (parts.length <= 3) return path;
  return parts.slice(-3).join(" > ");
}

export function registerTestResponsive(server: McpServer): void {
  server.tool(
    "test_responsive",
    `Test the page across multiple viewport widths and report responsive breakage.

Tests standard breakpoints (320, 375, 768, 1024, 1280, 1920) or custom ones.
Detects:
- Horizontal overflow: elements wider than viewport causing horizontal scroll
- Visibility changes: elements hidden at some breakpoints but visible at others
- Layout shifts: flex-direction, flex-wrap, position, display changes between breakpoints

Example: test_responsive() — test all standard breakpoints
Example: test_responsive({ breakpoints: [320, 768, 1440] }) — test specific widths`,
    {
      breakpoints: z.array(z.number()).optional().describe("Custom viewport widths to test (default: [320, 375, 768, 1024, 1280, 1920])"),
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
        const breakpoints = params.breakpoints ?? DEFAULT_BREAKPOINTS;
        const sorted = [...breakpoints].sort((a, b) => a - b);

        const snapshots: BreakpointSnapshot[] = [];

        for (const width of sorted) {
          await client.Emulation.setDeviceMetricsOverride({
            width,
            height: 900,
            deviceScaleFactor: 1,
            mobile: width < 768,
          });
          await new Promise(r => setTimeout(r, 300));

          const extractor = new LayoutExtractor(connection);
          const tree = await extractor.extractTree({ lightweight: true });
          const flat = flattenWithPaths(tree.root);
          const nodesByPath = new Map<string, LayoutNode>();
          for (const { node, path } of flat) {
            if (!nodesByPath.has(path)) {
              nodesByPath.set(path, node);
            }
          }

          snapshots.push({
            width,
            label: getLabel(width),
            tree,
            nodesByPath,
          });
        }

        const allPaths = new Set<string>();
        for (const snap of snapshots) {
          for (const path of snap.nodesByPath.keys()) {
            allPaths.add(path);
          }
        }

        // 1. Horizontal overflow per breakpoint
        const overflowByBreakpoint = new Map<number, OverflowIssue[]>();

        for (const snap of snapshots) {
          const overflows: OverflowIssue[] = [];
          const seen = new Set<string>();

          for (const [path, node] of snap.nodesByPath) {
            if (node.tag === "html" || node.tag === "body") continue;

            const totalWidth = node.boxModel.total.width;
            if (totalWidth > snap.width + 1) {
              seen.add(path);
              overflows.push({
                path,
                selector: node.selector,
                elementWidth: Math.round(totalWidth),
                viewportWidth: snap.width,
                isScrollOverflow: false,
              });
            }

            if (
              !seen.has(path) &&
              node.scroll.scrollWidth > node.scroll.clientWidth + 1 &&
              node.scroll.clientWidth > 0
            ) {
              overflows.push({
                path,
                selector: node.selector,
                elementWidth: node.scroll.scrollWidth,
                viewportWidth: snap.width,
                isScrollOverflow: true,
              });
            }
          }

          if (overflows.length > 0) {
            overflowByBreakpoint.set(snap.width, overflows);
          }
        }

        // 2. Visibility changes
        // Elements missing from a snapshot were display:none (batch extraction skips them)
        const visibilityChanges: VisibilityChange[] = [];

        for (const path of allPaths) {
          const parts = path.split(" > ");
          const leaf = parts[parts.length - 1];
          if (leaf === "html" || leaf === "body") continue;

          const visibleAt: number[] = [];
          const hiddenAt: number[] = [];

          for (const snap of snapshots) {
            if (snap.nodesByPath.has(path)) {
              visibleAt.push(snap.width);
            } else {
              hiddenAt.push(snap.width);
            }
          }

          if (hiddenAt.length > 0 && visibleAt.length > 0) {
            visibilityChanges.push({
              path,
              selector: shortPath(path),
              hiddenAt,
              visibleAt,
            });
          }
        }

        // 3. Layout property changes across breakpoints
        const layoutChanges: LayoutChange[] = [];
        const trackedProps = ["flexDirection", "flexWrap", "position", "display"] as const;

        for (const path of allPaths) {
          const parts = path.split(" > ");
          const leaf = parts[parts.length - 1];
          if (leaf === "html" || leaf === "body") continue;

          for (const prop of trackedProps) {
            const values: Array<{ width: number; value: string }> = [];

            for (const snap of snapshots) {
              const node = snap.nodesByPath.get(path);
              if (node) {
                const val = node.computed[prop] ?? "";
                if (val) values.push({ width: snap.width, value: val });
              }
            }

            if (values.length < 2) continue;

            const unique = new Set(values.map(v => v.value));
            if (unique.size > 1) {
              layoutChanges.push({
                path,
                selector: shortPath(path),
                property: prop,
                changes: values,
              });
            }
          }
        }

        // --- Format output ---
        const lines: string[] = [];
        lines.push(`RESPONSIVE ANALYSIS: ${sorted.length} viewports tested`);

        const breakpointsWithIssues = new Set<number>();

        for (const snap of snapshots) {
          const overflows = overflowByBreakpoint.get(snap.width);
          if (overflows && overflows.length > 0) {
            breakpointsWithIssues.add(snap.width);
            lines.push("");
            lines.push(`BREAKAGE AT ${snap.width}px (${snap.label}):`);
            const byOverflow = [...overflows].sort(
              (a, b) => (b.elementWidth - b.viewportWidth) - (a.elementWidth - a.viewportWidth),
            );
            const shown = byOverflow.slice(0, 10);
            for (let i = 0; i < shown.length; i++) {
              const o = shown[i];
              const overflow = o.elementWidth - o.viewportWidth;
              if (o.isScrollOverflow) {
                lines.push(`  ${i + 1}. ${o.selector} causes horizontal scroll`);
                lines.push(`     scroll content: ${o.elementWidth}px, container: ${o.viewportWidth}px`);
              } else {
                lines.push(`  ${i + 1}. ${o.selector} overflows viewport by ${overflow}px`);
                lines.push(`     element width: ${o.elementWidth}px, viewport: ${o.viewportWidth}px`);
              }
              lines.push(`     suggestion: add overflow-x: auto on parent or use responsive pattern`);
            }
            if (byOverflow.length > 10) {
              lines.push(`  ... and ${byOverflow.length - 10} more overflow issues`);
            }
          }
        }

        if (layoutChanges.length > 0) {
          lines.push("");
          lines.push("LAYOUT CHANGES:");
          const shown = layoutChanges.slice(0, 20);
          for (const change of shown) {
            const desc = change.changes
              .map(c => `${c.width}px: ${c.value}`)
              .join(", ");
            lines.push(`  ${change.selector} — ${change.property}: ${desc}`);
          }
          if (layoutChanges.length > 20) {
            lines.push(`  ... and ${layoutChanges.length - 20} more layout changes`);
          }
        }

        if (visibilityChanges.length > 0) {
          lines.push("");
          lines.push("VISIBILITY CHANGES:");
          const shown = visibilityChanges.slice(0, 20);
          for (const vc of shown) {
            const hiddenStr = vc.hiddenAt.map(w => `${w}px`).join(", ");
            const visibleMin = Math.min(...vc.visibleAt);
            const allAbove = vc.visibleAt.every(w => w >= visibleMin);
            const visibleStr = allAbove && vc.visibleAt.length > 1
              ? `${visibleMin}px+`
              : vc.visibleAt.map(w => `${w}px`).join(", ");
            lines.push(`  ${vc.selector}: hidden at ${hiddenStr} — visible at ${visibleStr}`);
          }
          if (visibilityChanges.length > 20) {
            lines.push(`  ... and ${visibilityChanges.length - 20} more visibility changes`);
          }
        }

        const cleanBreakpoints = sorted.filter(w => !breakpointsWithIssues.has(w));
        if (cleanBreakpoints.length > 0) {
          lines.push("");
          lines.push(`ALL CLEAR: ${cleanBreakpoints.map(w => `${w}px`).join(", ")}`);
        }

        lines.push("");
        const issueCount = breakpointsWithIssues.size;
        const cleanCount = cleanBreakpoints.length;
        lines.push(
          `SUMMARY: ${issueCount} breakpoint${issueCount !== 1 ? "s" : ""} with overflow issues, ${cleanCount} clean`,
        );
        if (visibilityChanges.length > 0) {
          lines.push(
            `         ${visibilityChanges.length} element${visibilityChanges.length !== 1 ? "s" : ""} with visibility changes`,
          );
        }
        if (layoutChanges.length > 0) {
          lines.push(
            `         ${layoutChanges.length} layout property change${layoutChanges.length !== 1 ? "s" : ""} across breakpoints`,
          );
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `ERROR: ${message}` }],
          isError: true,
        };
      } finally {
        if (connection) {
          try {
            await connection.client.Emulation.clearDeviceMetricsOverride();
          } catch {
            // connection might already be closed
          }
          await connection.disconnect();
        }
      }
    },
  );
}
