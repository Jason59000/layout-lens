import type CDP from "chrome-remote-interface";

export interface TransformEntry {
  selector: string;
  transform: string;
  origin: string;
}

export async function getTransformChain(
  client: CDP.Client,
  cssSelector: string,
): Promise<TransformEntry[] | null> {
  const escapedSel = JSON.stringify(cssSelector);
  const result = await client.Runtime.evaluate({
    expression: `(function() {
      var el = document.querySelector(${escapedSel});
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
  if (result.result.value) {
    return JSON.parse(result.result.value as string);
  }
  return null;
}
