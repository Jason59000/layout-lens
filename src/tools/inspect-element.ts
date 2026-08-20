import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CDPConnection } from "../cdp/connection.js";
import { LayoutExtractor } from "../cdp/extractor.js";
import type { LayoutNode, LayoutTree } from "../types.js";
import { walkTree } from "../types.js";
import { formatElement } from "../formatter/text.js";

/**
 * Find a node in the tree by matching its selector path.
 * Matches against tag, id, classes.
 */
function findNodeBySelector(
  tree: LayoutTree,
  selector: string,
): LayoutNode | undefined {
  const selectorLower = selector.toLowerCase();
  let match: LayoutNode | undefined;

  walkTree(tree, (node) => {
    if (match) return; // already found

    // Match by id
    if (selector.startsWith("#") && node.id === selector.slice(1)) {
      match = node;
      return;
    }

    // Match by class
    if (selector.startsWith(".")) {
      const className = selector.slice(1);
      if (node.classes.includes(className)) {
        match = node;
        return;
      }
    }

    // Match full selector (tag.class or tag#id)
    const nodeSelector = buildMatchSelector(node);
    if (nodeSelector.toLowerCase() === selectorLower) {
      match = node;
      return;
    }

    // Match the node's own selector property
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

        let eventListeners: string[] = [];
        try {
          const client = connection.client;
          const resolved = await client.DOM.resolveNode({ nodeId: node.nodeId });
          if (resolved.object.objectId) {
            const listeners = await client.DOMDebugger.getEventListeners({
              objectId: resolved.object.objectId,
            });
            eventListeners = listeners.listeners.map(
              (l) => `${l.type}${l.once ? " (once)" : ""}${l.passive ? " (passive)" : ""}`,
            );
          }
        } catch {
          // DOMDebugger may not be available
        }

        let reactComponent: { name: string; hierarchy: string[] } | null = null;
        try {
          const client = connection.client;
          const escapedSelector = JSON.stringify(params.selector);
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
            reactComponent = JSON.parse(reactResult.result.value as string);
          }
        } catch {
          // React not available or element not a React component
        }

        let cssVariables: Array<{ name: string; value: string }> = [];
        try {
          const client = connection.client;
          const { computedStyle } = await client.CSS.getComputedStyleForNode({ nodeId: node.nodeId });
          cssVariables = computedStyle
            .filter(p => p.name.startsWith("--"))
            .map(p => ({ name: p.name, value: p.value }));
        } catch {
          // CSS domain may not be available
        }

        let blendedBackgroundColor: string | undefined;
        try {
          const client = connection.client;
          const bgResult = await (client.CSS as any).getBackgroundColors({ nodeId: node.nodeId });
          if (bgResult.backgroundColors && bgResult.backgroundColors.length > 0) {
            blendedBackgroundColor = bgResult.backgroundColors[0];
          }
        } catch {
          // getBackgroundColors may not be available
        }

        let containingBlock: { selector: string; reason: string } | undefined;
        try {
          const client = connection.client;
          const escapedSel = JSON.stringify(params.selector);
          const cbResult = await client.Runtime.evaluate({
            expression: `(function() {
              var el = document.querySelector(${escapedSel});
              if (!el) return null;
              var cs = getComputedStyle(el);
              var pos = cs.position;
              if (pos === "static" || pos === "relative") return null;
              function desc(e) {
                var t = e.tagName.toLowerCase();
                if (e.id) return t + "#" + e.id;
                var cn = e.className;
                if (cn && typeof cn === "string") {
                  var c = cn.split(/\\s+/).filter(Boolean);
                  if (c.length > 0) return t + "." + c[0];
                }
                return t;
              }
              if (pos === "absolute") {
                var p = el.parentElement;
                while (p && p !== document.documentElement) {
                  if (getComputedStyle(p).position !== "static") {
                    return JSON.stringify({ selector: desc(p), reason: "position: " + getComputedStyle(p).position });
                  }
                  p = p.parentElement;
                }
                return JSON.stringify({ selector: "viewport", reason: "initial containing block" });
              }
              if (pos === "fixed") {
                var p = el.parentElement;
                while (p && p !== document.documentElement) {
                  var pcs = getComputedStyle(p);
                  if (pcs.transform !== "none") return JSON.stringify({ selector: desc(p), reason: "transform" });
                  if (pcs.filter !== "none") return JSON.stringify({ selector: desc(p), reason: "filter" });
                  var cnt = pcs.contain;
                  if (cnt === "paint" || cnt === "layout" || cnt === "strict" || cnt === "content") {
                    return JSON.stringify({ selector: desc(p), reason: "contain: " + cnt });
                  }
                  p = p.parentElement;
                }
                return JSON.stringify({ selector: "viewport", reason: "fixed positioning" });
              }
              if (pos === "sticky") {
                var p = el.parentElement;
                while (p && p !== document.documentElement) {
                  var pcs = getComputedStyle(p);
                  if (pcs.overflowX !== "visible" || pcs.overflowY !== "visible") {
                    return JSON.stringify({ selector: desc(p), reason: "overflow: " + pcs.overflowX + "/" + pcs.overflowY });
                  }
                  p = p.parentElement;
                }
                return JSON.stringify({ selector: "viewport", reason: "no overflow ancestor" });
              }
              return null;
            })()`,
            returnByValue: true,
          });
          if (cbResult.result.value) {
            containingBlock = JSON.parse(cbResult.result.value as string);
          }
        } catch {
          // containing block detection is best-effort
        }

        let hitTestResult: { point: { x: number; y: number }; elementIndex: number; stack: string[] } | null = null;
        try {
          const client = connection.client;
          const escapedSel2 = JSON.stringify(params.selector);
          const htResult = await client.Runtime.evaluate({
            expression: `(function() {
              var el = document.querySelector(${escapedSel2});
              if (!el) return null;
              var rect = el.getBoundingClientRect();
              var cx = rect.left + rect.width / 2;
              var cy = rect.top + rect.height / 2;
              var stack = document.elementsFromPoint(cx, cy);
              var idx = stack.indexOf(el);
              return JSON.stringify({
                point: { x: Math.round(cx), y: Math.round(cy) },
                elementIndex: idx,
                stack: stack.slice(0, 10).map(function(e) {
                  var t = e.tagName.toLowerCase();
                  if (e.id) t += "#" + e.id;
                  else if (e.className && typeof e.className === "string") {
                    var cls = e.className.split(/\\s+/).filter(Boolean);
                    if (cls.length > 0) t += "." + cls[0];
                  }
                  return t;
                })
              });
            })()`,
            returnByValue: true,
          });
          if (htResult.result.value) {
            hitTestResult = JSON.parse(htResult.result.value as string);
          }
        } catch {
          // hit-testing is best-effort
        }

        let clippingChain: Array<{ selector: string; reasons: string[] }> | null = null;
        try {
          const client = connection.client;
          const escapedSel3 = JSON.stringify(params.selector);
          const clipResult = await client.Runtime.evaluate({
            expression: `(function() {
              var el = document.querySelector(${escapedSel3});
              if (!el) return null;
              var clips = [];
              var p = el.parentElement;
              while (p && p !== document.documentElement) {
                var cs = getComputedStyle(p);
                var reasons = [];
                if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
                  reasons.push("overflow: " + cs.overflowX + "/" + cs.overflowY);
                }
                if (cs.clipPath && cs.clipPath !== "none") {
                  reasons.push("clip-path: " + cs.clipPath);
                }
                if (cs.contain) {
                  var cnt = cs.contain;
                  if (cnt === "paint" || cnt === "strict" || cnt === "content" || cnt.includes("paint")) {
                    reasons.push("contain: " + cnt);
                  }
                }
                if (reasons.length > 0) {
                  var t = p.tagName.toLowerCase();
                  if (p.id) t += "#" + p.id;
                  else if (p.className && typeof p.className === "string") {
                    var c = p.className.split(/\\s+/).filter(Boolean);
                    if (c.length > 0) t += "." + c[0];
                  }
                  clips.push({ selector: t, reasons: reasons });
                }
                p = p.parentElement;
              }
              return clips.length > 0 ? JSON.stringify(clips) : null;
            })()`,
            returnByValue: true,
          });
          if (clipResult.result.value) {
            clippingChain = JSON.parse(clipResult.result.value as string);
          }
        } catch {
          // clipping chain is best-effort
        }

        let platformFonts: Array<{ familyName: string; postScriptName: string; glyphCount: number }> = [];
        try {
          const client = connection.client;
          const fontsResult = await (client.CSS as any).getPlatformFontsForNode({ nodeId: node.nodeId });
          if (fontsResult.fonts && fontsResult.fonts.length > 0) {
            platformFonts = fontsResult.fonts.map((f: any) => ({
              familyName: f.familyName,
              postScriptName: f.postScriptName || "",
              glyphCount: f.glyphCount,
            }));
          }
        } catch {
          // getPlatformFontsForNode may not be available
        }

        let interactionState: { interactive: boolean; reasons: string[] } | null = null;
        try {
          const client = connection.client;
          const escapedSel4 = JSON.stringify(params.selector);
          const intResult = await client.Runtime.evaluate({
            expression: `(function() {
              var el = document.querySelector(${escapedSel4});
              if (!el) return null;
              var reasons = [];
              var cs = getComputedStyle(el);
              if (cs.pointerEvents === "none") reasons.push("pointer-events: none");
              if (cs.visibility === "hidden") reasons.push("visibility: hidden");
              if (cs.opacity === "0") reasons.push("opacity: 0");
              if (el.inert) reasons.push("inert");
              if (el.disabled) reasons.push("disabled");
              if (el.getAttribute("aria-disabled") === "true") reasons.push("aria-disabled");
              if (el.getAttribute("aria-hidden") === "true") reasons.push("aria-hidden");
              if (cs.display === "none") reasons.push("display: none");
              var p = el.parentElement;
              while (p) {
                if (p.inert) { reasons.push("ancestor inert: " + (p.tagName.toLowerCase())); break; }
                p = p.parentElement;
              }
              return JSON.stringify({ interactive: reasons.length === 0, reasons: reasons });
            })()`,
            returnByValue: true,
          });
          if (intResult.result.value) {
            interactionState = JSON.parse(intResult.result.value as string);
          }
        } catch {
          // interaction state is best-effort
        }

        let focusInfo: { isFocused: boolean; tabIndex: number | null; focusable: boolean; inertAncestor: string | null } | null = null;
        try {
          const client = connection.client;
          const escapedSel5 = JSON.stringify(params.selector);
          const focusResult = await client.Runtime.evaluate({
            expression: `(function() {
              var el = document.querySelector(${escapedSel5});
              if (!el) return null;
              var isFocused = document.activeElement === el;
              var tabIdx = el.getAttribute("tabindex");
              var focusable = el.tabIndex >= 0;
              var inertAnc = null;
              var p = el;
              while (p) {
                if (p.inert) {
                  var t = p.tagName.toLowerCase();
                  if (p.id) t += "#" + p.id;
                  inertAnc = t;
                  break;
                }
                p = p.parentElement;
              }
              return JSON.stringify({
                isFocused: isFocused,
                tabIndex: tabIdx !== null ? parseInt(tabIdx, 10) : null,
                focusable: focusable,
                inertAncestor: inertAnc
              });
            })()`,
            returnByValue: true,
          });
          if (focusResult.result.value) {
            focusInfo = JSON.parse(focusResult.result.value as string);
          }
        } catch {
          // focus info is best-effort
        }

        let scrollOwnership: Array<{ selector: string; overflow: string; scrollable: string }> | null = null;
        try {
          const client = connection.client;
          const escapedSel6 = JSON.stringify(params.selector);
          const scrollResult = await client.Runtime.evaluate({
            expression: `(function() {
              var el = document.querySelector(${escapedSel6});
              if (!el) return null;
              var chain = [];
              var p = el.parentElement;
              while (p && p !== document.documentElement) {
                var cs = getComputedStyle(p);
                var ox = cs.overflowX, oy = cs.overflowY;
                if (ox !== "visible" || oy !== "visible") {
                  var t = p.tagName.toLowerCase();
                  if (p.id) t += "#" + p.id;
                  else if (p.className && typeof p.className === "string") {
                    var c = p.className.split(/\\s+/).filter(Boolean);
                    if (c.length > 0) t += "." + c[0];
                  }
                  var dirs = [];
                  if (p.scrollWidth > p.clientWidth) dirs.push("horizontal");
                  if (p.scrollHeight > p.clientHeight) dirs.push("vertical");
                  chain.push({
                    selector: t,
                    overflow: ox + "/" + oy,
                    scrollable: dirs.length > 0 ? dirs.join("+") : "no overflow"
                  });
                }
                p = p.parentElement;
              }
              return chain.length > 0 ? JSON.stringify(chain) : null;
            })()`,
            returnByValue: true,
          });
          if (scrollResult.result.value) {
            scrollOwnership = JSON.parse(scrollResult.result.value as string);
          }
        } catch {
          // scroll ownership is best-effort
        }

        let gridFlexGeometry: any = null;
        try {
          const client = connection.client;
          const escapedSel7 = JSON.stringify(params.selector);
          const gfResult = await client.Runtime.evaluate({
            expression: `(function() {
              var el = document.querySelector(${escapedSel7});
              if (!el) return null;
              var cs = getComputedStyle(el);
              var d = cs.display;
              if (d === "grid" || d === "inline-grid") {
                var cols = cs.gridTemplateColumns;
                var rows = cs.gridTemplateRows;
                var items = [];
                for (var i = 0; i < el.children.length && i < 20; i++) {
                  var child = el.children[i];
                  var ccs = getComputedStyle(child);
                  var t = child.tagName.toLowerCase();
                  if (child.className && typeof child.className === "string") {
                    var c = child.className.split(/\\s+/).filter(Boolean);
                    if (c.length > 0) t += "." + c[0];
                  }
                  items.push({
                    selector: t,
                    gridColumn: ccs.gridColumnStart + " / " + ccs.gridColumnEnd,
                    gridRow: ccs.gridRowStart + " / " + ccs.gridRowEnd
                  });
                }
                return JSON.stringify({ type: "grid", columns: cols, rows: rows, gap: cs.gap, items: items });
              }
              if (d === "flex" || d === "inline-flex") {
                var items = [];
                for (var i = 0; i < el.children.length && i < 20; i++) {
                  var child = el.children[i];
                  var ccs = getComputedStyle(child);
                  var rect = child.getBoundingClientRect();
                  var t = child.tagName.toLowerCase();
                  if (child.className && typeof child.className === "string") {
                    var c = child.className.split(/\\s+/).filter(Boolean);
                    if (c.length > 0) t += "." + c[0];
                  }
                  items.push({
                    selector: t,
                    flexGrow: ccs.flexGrow, flexShrink: ccs.flexShrink, flexBasis: ccs.flexBasis,
                    width: Math.round(rect.width), height: Math.round(rect.height)
                  });
                }
                return JSON.stringify({
                  type: "flex", direction: cs.flexDirection, wrap: cs.flexWrap,
                  justify: cs.justifyContent, align: cs.alignItems, gap: cs.gap,
                  items: items
                });
              }
              return null;
            })()`,
            returnByValue: true,
          });
          if (gfResult.result.value) {
            gridFlexGeometry = JSON.parse(gfResult.result.value as string);
          }
        } catch {
          // grid/flex geometry is best-effort
        }

        let transformChain: Array<{ selector: string; transform: string; origin: string }> | null = null;
        try {
          const client = connection.client;
          const escapedSel8 = JSON.stringify(params.selector);
          const txResult = await client.Runtime.evaluate({
            expression: `(function() {
              var el = document.querySelector(${escapedSel8});
              if (!el) return null;
              var chain = [];
              var cur = el;
              while (cur && cur !== document.documentElement) {
                var cs = getComputedStyle(cur);
                if (cs.transform && cs.transform !== "none") {
                  var t = cur.tagName.toLowerCase();
                  if (cur.id) t += "#" + cur.id;
                  else if (cur.className && typeof cur.className === "string") {
                    var c = cur.className.split(/\\s+/).filter(Boolean);
                    if (c.length > 0) t += "." + c[0];
                  }
                  chain.push({ selector: t, transform: cs.transform, origin: cs.transformOrigin });
                }
                cur = cur.parentElement;
              }
              return chain.length > 0 ? JSON.stringify(chain) : null;
            })()`,
            returnByValue: true,
          });
          if (txResult.result.value) {
            transformChain = JSON.parse(txResult.result.value as string);
          }
        } catch {
          // transform chain is best-effort
        }

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

        if (blendedBackgroundColor) {
          const bgComp = node.computed.backgroundColor ?? "transparent";
          text += `\n\nBACKGROUND:\n  declared: ${bgComp}\n  blended (visible): ${blendedBackgroundColor}`;
        }

        if (eventListeners.length > 0) {
          text += `\n\nEVENT LISTENERS:\n  ${eventListeners.join("\n  ")}`;
        }

        if (hitTestResult) {
          text += `\n\nHIT-TEST (center ${hitTestResult.point.x},${hitTestResult.point.y}):`;
          for (let i = 0; i < hitTestResult.stack.length; i++) {
            const marker = i === hitTestResult.elementIndex ? " <-- THIS ELEMENT" : "";
            text += `\n  ${i}: ${hitTestResult.stack[i]}${marker}`;
          }
          if (hitTestResult.elementIndex > 0) {
            text += `\n  ${hitTestResult.elementIndex} element(s) above — may block pointer events`;
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
