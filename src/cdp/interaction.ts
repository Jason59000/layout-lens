import type CDP from "chrome-remote-interface";

export interface InteractionState {
  interactive: boolean;
  reasons: string[];
}

export interface FocusInfo {
  isFocused: boolean;
  tabIndex: number | null;
  focusable: boolean;
  inertAncestor: string | null;
}

export async function getInteractionState(
  client: CDP.Client,
  cssSelector: string,
): Promise<InteractionState | null> {
  const escapedSel = JSON.stringify(cssSelector);
  const result = await client.Runtime.evaluate({
    expression: `(function() {
      var el = document.querySelector(${escapedSel});
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
  if (result.result.value) {
    return JSON.parse(result.result.value as string);
  }
  return null;
}

export async function getFocusInfo(
  client: CDP.Client,
  cssSelector: string,
): Promise<FocusInfo | null> {
  const escapedSel = JSON.stringify(cssSelector);
  const result = await client.Runtime.evaluate({
    expression: `(function() {
      var el = document.querySelector(${escapedSel});
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
  if (result.result.value) {
    return JSON.parse(result.result.value as string);
  }
  return null;
}
