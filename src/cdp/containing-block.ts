import type CDP from "chrome-remote-interface";

export interface ContainingBlockInfo {
  selector: string;
  reason: string;
}

export async function getContainingBlock(
  client: CDP.Client,
  cssSelector: string,
): Promise<ContainingBlockInfo | null> {
  const escapedSel = JSON.stringify(cssSelector);
  const result = await client.Runtime.evaluate({
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
  if (result.result.value) {
    return JSON.parse(result.result.value as string);
  }
  return null;
}
