import type CDP from "chrome-remote-interface";

export interface ClipEntry {
  selector: string;
  reasons: string[];
}

export async function getClippingChain(
  client: CDP.Client,
  cssSelector: string,
): Promise<ClipEntry[] | null> {
  const escapedSel = JSON.stringify(cssSelector);
  const result = await client.Runtime.evaluate({
    expression: `(function() {
      var el = document.querySelector(${escapedSel});
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
  if (result.result.value) {
    return JSON.parse(result.result.value as string);
  }
  return null;
}
