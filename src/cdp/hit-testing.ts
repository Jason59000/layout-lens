import type CDP from "chrome-remote-interface";

export interface HitTestResult {
  point: { x: number; y: number };
  topmost: string;
  topmostIgnoringPointerEvents: string;
  stack: string[];
  elementIndex: number;
  blocked: boolean;
}

async function describeNode(client: CDP.Client, nodeId: number): Promise<string> {
  try {
    const { node: n } = await client.DOM.describeNode({ nodeId });
    let s = n.localName || n.nodeName.toLowerCase();
    const attrs = n.attributes || [];
    for (let i = 0; i < attrs.length; i += 2) {
      if (attrs[i] === "id") s += `#${attrs[i + 1]}`;
      if (attrs[i] === "class") {
        const cls = attrs[i + 1].split(/\s+/).filter(Boolean);
        if (cls.length > 0) s += `.${cls[0]}`;
      }
    }
    return s;
  } catch { return `node:${nodeId}`; }
}

export async function getHitTest(
  client: CDP.Client,
  cssSelector: string,
  elementMatchLabel: string,
): Promise<HitTestResult | null> {
  const escapedSel = JSON.stringify(cssSelector);
  const centerResult = await client.Runtime.evaluate({
    expression: `(function() {
      var el = document.querySelector(${escapedSel});
      if (!el) return null;
      var r = el.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) });
    })()`,
    returnByValue: true,
  });
  if (!centerResult.result.value) return null;

  const center = JSON.parse(centerResult.result.value as string);
  const [normalHit, ignoreHit, stackResult] = await Promise.all([
    (client.DOM as any).getNodeForLocation({ x: center.x, y: center.y, includeUserAgentShadowDOM: false }).catch(() => null),
    (client.DOM as any).getNodeForLocation({ x: center.x, y: center.y, includeUserAgentShadowDOM: false, ignorePointerEventsNone: true }).catch(() => null),
    client.Runtime.evaluate({
      expression: `(function() {
        var stack = document.elementsFromPoint(${center.x}, ${center.y});
        return JSON.stringify(stack.slice(0, 10).map(function(e) {
          var t = e.tagName.toLowerCase();
          if (e.id) t += "#" + e.id;
          else if (e.className && typeof e.className === "string") {
            var cls = e.className.split(/\\s+/).filter(Boolean);
            if (cls.length > 0) t += "." + cls[0];
          }
          return t;
        }));
      })()`,
      returnByValue: true,
    }).catch(() => null),
  ]);

  const topmost = normalHit?.nodeId ? await describeNode(client, normalHit.nodeId) : "none";
  const topmostIgnoring = ignoreHit?.nodeId ? await describeNode(client, ignoreHit.nodeId) : "none";
  const stack: string[] = stackResult?.result?.value ? JSON.parse(stackResult.result.value as string) : [];
  const elementIndex = stack.findIndex(s => s.toLowerCase() === elementMatchLabel.toLowerCase());

  return {
    point: center,
    topmost,
    topmostIgnoringPointerEvents: topmostIgnoring,
    stack,
    elementIndex,
    blocked: elementIndex > 0,
  };
}
