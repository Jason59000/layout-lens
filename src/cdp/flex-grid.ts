import type CDP from "chrome-remote-interface";

export interface GridGeometry {
  type: "grid";
  columns: string;
  rows: string;
  gap: string;
  items: Array<{ selector: string; gridColumn: string; gridRow: string }>;
}

export interface FlexGeometry {
  type: "flex";
  direction: string;
  wrap: string;
  justify: string;
  align: string;
  gap: string;
  items: Array<{ selector: string; flexGrow: string; flexShrink: string; flexBasis: string; width: number; height: number }>;
}

export type FlexGridGeometry = GridGeometry | FlexGeometry;

export async function getFlexGridGeometry(
  client: CDP.Client,
  cssSelector: string,
): Promise<FlexGridGeometry | null> {
  const escapedSel = JSON.stringify(cssSelector);
  const result = await client.Runtime.evaluate({
    expression: `(function() {
      var el = document.querySelector(${escapedSel});
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
  if (result.result.value) {
    return JSON.parse(result.result.value as string);
  }
  return null;
}
