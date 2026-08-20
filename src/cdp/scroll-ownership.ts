import type CDP from "chrome-remote-interface";

export interface ScrollOwnerEntry {
  selector: string;
  overflow: string;
  scrollable: string;
}

export async function getScrollOwnership(
  client: CDP.Client,
  cssSelector: string,
): Promise<ScrollOwnerEntry[] | null> {
  const escapedSel = JSON.stringify(cssSelector);
  const result = await client.Runtime.evaluate({
    expression: `(function() {
      var el = document.querySelector(${escapedSel});
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
  if (result.result.value) {
    return JSON.parse(result.result.value as string);
  }
  return null;
}
