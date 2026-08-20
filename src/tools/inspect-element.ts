import type CDP from "chrome-remote-interface";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CDPConnection } from "../cdp/connection.js";
import { LayoutExtractor } from "../cdp/extractor.js";
import type { LayoutNode, LayoutTree } from "../types.js";
import { walkTree } from "../types.js";
import { formatElement } from "../formatter/text.js";
import { getContainingBlock } from "../cdp/containing-block.js";
import { getHitTest } from "../cdp/hit-testing.js";
import { getClippingChain } from "../cdp/clipping.js";
import { getPlatformFonts } from "../cdp/fonts.js";
import { getInteractionState, getFocusInfo } from "../cdp/interaction.js";
import { getFlexGridGeometry } from "../cdp/flex-grid.js";
import { getTransformChain } from "../cdp/transforms.js";
import { getScrollOwnership } from "../cdp/scroll-ownership.js";

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

    const nodeSelector = buildMatchSelector(node);
    if (nodeSelector.toLowerCase() === selectorLower) {
      match = node;
      return;
    }

    if (node.selector.toLowerCase() === selectorLower) {
      match = node;
      return;
    }
  });

  return match;
}

function buildMatchSelector(node: LayoutNode): string {
  let sel = node.tag;
  if (node.id) sel += `#${node.id}`;
  if (node.classes.length > 0) sel += node.classes.map((c) => `.${c}`).join("");
  return sel;
}

export function registerInspectElement(server: McpServer): void {
  server.tool(
    "inspect_element",
    "Inspect a specific element by CSS selector. Returns detailed box model, computed styles, CSS rules, parent relationship, stacking context, event listeners, and React component mapping.",
    {
      selector: z.string().describe("CSS selector to find the element (e.g. '#my-id', '.my-class', 'div.container')"),
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

        const client = connection.client;
        const sel = params.selector;
        const matchLabel = buildMatchSelector(node);

        const [
          eventListeners,
          reactComponent,
          cssVariables,
          blendedBg,
          containingBlock,
          hitTestResult,
          clippingChain,
          platformFonts,
          interactionState,
          focusInfo,
          scrollOwnership,
          gridFlexGeometry,
          transformChain,
          contentQuads,
        ] = await Promise.all([
          getEventListeners(client, node.nodeId),
          getReactComponent(client, sel),
          getCssVariables(client, node.nodeId),
          getBlendedBackground(client, node.nodeId),
          getContainingBlock(client, sel).catch(() => null),
          getHitTest(client, sel, matchLabel).catch(() => null),
          getClippingChain(client, sel).catch(() => null),
          getPlatformFonts(client, node.nodeId).catch(() => []),
          getInteractionState(client, sel).catch(() => null),
          getFocusInfo(client, sel).catch(() => null),
          getScrollOwnership(client, sel).catch(() => null),
          getFlexGridGeometry(client, sel).catch(() => null),
          getTransformChain(client, sel).catch(() => null),
          getContentQuads(client, node.nodeId),
        ]);

        let text = formatElement(node, tree);

        if (reactComponent) {
          const componentLine = `\n  component: <${reactComponent.name}>`;
          const hierarchyLine = `\n  in: ${reactComponent.hierarchy.map(c => `<${c}>`).join(" > ")}`;
          const headerEnd = text.indexOf("\n");
          text = text.slice(0, headerEnd) + componentLine + hierarchyLine + text.slice(headerEnd);
        }

        if (containingBlock) {
          text += `\n\nCONTAINING BLOCK:\n  ${containingBlock.selector} (${containingBlock.reason})`;
        }

        if (blendedBg) {
          const bgComp = node.computed.backgroundColor ?? "transparent";
          text += `\n\nBACKGROUND:\n  declared: ${bgComp}\n  blended (visible): ${blendedBg}`;
        }

        if (eventListeners.length > 0) {
          text += `\n\nEVENT LISTENERS:\n  ${eventListeners.join("\n  ")}`;
        }

        if (hitTestResult) {
          text += `\n\nHIT-TEST (center ${hitTestResult.point.x},${hitTestResult.point.y}):`;
          text += `\n  topmost (receives click): ${hitTestResult.topmost}`;
          if (hitTestResult.topmostIgnoringPointerEvents !== hitTestResult.topmost) {
            text += `\n  topmost (ignoring pointer-events): ${hitTestResult.topmostIgnoringPointerEvents}`;
          }
          text += "\n  stack:";
          for (let i = 0; i < hitTestResult.stack.length; i++) {
            const marker = i === hitTestResult.elementIndex ? " <-- THIS ELEMENT" : "";
            text += `\n    ${i}: ${hitTestResult.stack[i]}${marker}`;
          }
          if (hitTestResult.blocked) {
            text += `\n  BLOCKED: ${hitTestResult.elementIndex} element(s) above this element`;
          }
        }

        if (clippingChain && clippingChain.length > 0) {
          text += "\n\nCLIPPING CHAIN:";
          for (const clip of clippingChain) {
            text += `\n  ${clip.selector}: ${clip.reasons.join(", ")}`;
          }
        }

        if (interactionState) {
          text += `\n\nINTERACTION STATE: ${interactionState.interactive ? "INTERACTIVE" : "BLOCKED"}`;
          if (interactionState.reasons.length > 0) {
            for (const r of interactionState.reasons) {
              text += `\n  ${r}`;
            }
          }
        }

        if (focusInfo) {
          text += "\n\nFOCUS:";
          text += `\n  focusable: ${focusInfo.focusable}`;
          if (focusInfo.tabIndex !== null) text += `\n  tabindex: ${focusInfo.tabIndex}`;
          if (focusInfo.isFocused) text += "\n  currently focused: YES";
          if (focusInfo.inertAncestor) text += `\n  blocked by inert ancestor: ${focusInfo.inertAncestor}`;
        }

        if (scrollOwnership && scrollOwnership.length > 0) {
          text += "\n\nSCROLL OWNERSHIP CHAIN:";
          for (const s of scrollOwnership) {
            text += `\n  ${s.selector}: overflow ${s.overflow}, ${s.scrollable}`;
          }
        }

        if (gridFlexGeometry) {
          if (gridFlexGeometry.type === "grid") {
            text += "\n\nGRID GEOMETRY:";
            text += `\n  columns: ${gridFlexGeometry.columns}`;
            text += `\n  rows: ${gridFlexGeometry.rows}`;
            if (gridFlexGeometry.gap && gridFlexGeometry.gap !== "normal") text += `\n  gap: ${gridFlexGeometry.gap}`;
            if (gridFlexGeometry.items.length > 0) {
              text += "\n  items:";
              for (const item of gridFlexGeometry.items) {
                text += `\n    ${item.selector}: col ${item.gridColumn}, row ${item.gridRow}`;
              }
            }
          } else if (gridFlexGeometry.type === "flex") {
            text += "\n\nFLEX GEOMETRY:";
            text += `\n  direction: ${gridFlexGeometry.direction}, wrap: ${gridFlexGeometry.wrap}`;
            text += `\n  justify: ${gridFlexGeometry.justify}, align: ${gridFlexGeometry.align}`;
            if (gridFlexGeometry.gap && gridFlexGeometry.gap !== "normal") text += `\n  gap: ${gridFlexGeometry.gap}`;
            if (gridFlexGeometry.items.length > 0) {
              text += "\n  items:";
              for (const item of gridFlexGeometry.items) {
                text += `\n    ${item.selector}: grow=${item.flexGrow} shrink=${item.flexShrink} basis=${item.flexBasis} (${item.width}x${item.height})`;
              }
            }
          }
        }

        if (contentQuads && contentQuads.length > 1) {
          text += `\n\nINLINE FRAGMENTS (${contentQuads.length} boxes):`;
          for (let i = 0; i < contentQuads.length; i++) {
            const q = contentQuads[i];
            text += `\n  line ${i + 1}: ${q.width}x${q.height} at (${q.x}, ${q.y})`;
          }
        }

        if (transformChain && transformChain.length > 0) {
          text += "\n\nTRANSFORM CHAIN:";
          for (const tx of transformChain) {
            text += `\n  ${tx.selector}: ${tx.transform} (origin: ${tx.origin})`;
          }
        }

        if (platformFonts.length > 0) {
          text += "\n\nFONTS (actual):";
          for (const f of platformFonts) {
            text += `\n  ${f.familyName} (${f.glyphCount} glyphs)`;
            if (f.postScriptName) text += ` [${f.postScriptName}]`;
          }
          const declared = node.computed.fontSize ? `font-size: ${node.computed.fontSize}` : "";
          if (declared) text += `\n  ${declared}`;
        }

        if (cssVariables.length > 0) {
          text += "\n\nCSS VARIABLES:";
          for (const v of cssVariables) {
            text += `\n  ${v.name}: ${v.value}`;
          }
        }

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

async function getEventListeners(client: CDP.Client, nodeId: number): Promise<string[]> {
  try {
    const resolved = await client.DOM.resolveNode({ nodeId });
    if (!resolved.object.objectId) return [];
    const listeners = await client.DOMDebugger.getEventListeners({
      objectId: resolved.object.objectId,
    });
    return listeners.listeners.map(
      (l) => `${l.type}${l.once ? " (once)" : ""}${l.passive ? " (passive)" : ""}`,
    );
  } catch {
    return [];
  }
}

async function getReactComponent(
  client: CDP.Client,
  cssSelector: string,
): Promise<{ name: string; hierarchy: string[] } | null> {
  try {
    const escapedSelector = JSON.stringify(cssSelector);
    const reactResult = await client.Runtime.evaluate({
      expression: `(function() {
        var el = document.querySelector(${escapedSelector});
        if (!el) return null;
        var key = Object.keys(el).find(function(k) { return k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'); });
        if (!key) return null;
        var fiber = el[key];
        var components = [];
        var f = fiber;
        while (f) {
          if (f.type && typeof f.type === 'function') {
            components.push(f.type.displayName || f.type.name || '(anonymous)');
          }
          f = f.return;
          if (components.length > 5) break;
        }
        return components.length > 0 ? JSON.stringify({ name: components[0], hierarchy: components.reverse() }) : null;
      })()`,
      returnByValue: true,
    });
    if (reactResult.result.value) {
      return JSON.parse(reactResult.result.value as string);
    }
  } catch {
    // not React
  }
  return null;
}

async function getCssVariables(
  client: CDP.Client,
  nodeId: number,
): Promise<Array<{ name: string; value: string }>> {
  try {
    const { computedStyle } = await client.CSS.getComputedStyleForNode({ nodeId });
    return computedStyle
      .filter(p => p.name.startsWith("--"))
      .map(p => ({ name: p.name, value: p.value }));
  } catch {
    return [];
  }
}

async function getBlendedBackground(
  client: CDP.Client,
  nodeId: number,
): Promise<string | undefined> {
  try {
    const bgResult = await (client.CSS as any).getBackgroundColors({ nodeId });
    if (bgResult.backgroundColors && bgResult.backgroundColors.length > 0) {
      return bgResult.backgroundColors[0];
    }
  } catch {
    // not available
  }
  return undefined;
}

async function getContentQuads(
  client: CDP.Client,
  nodeId: number,
): Promise<Array<{ x: number; y: number; width: number; height: number }> | null> {
  try {
    const quadsResult = await (client.DOM as any).getContentQuads({ nodeId });
    if (quadsResult.quads && quadsResult.quads.length > 1) {
      return quadsResult.quads.map((q: number[]) => {
        const xs = [q[0], q[2], q[4], q[6]];
        const ys = [q[1], q[3], q[5], q[7]];
        return {
          x: Math.round(Math.min(...xs)),
          y: Math.round(Math.min(...ys)),
          width: Math.round(Math.max(...xs) - Math.min(...xs)),
          height: Math.round(Math.max(...ys) - Math.min(...ys)),
        };
      });
    }
  } catch {
    // not available
  }
  return null;
}
