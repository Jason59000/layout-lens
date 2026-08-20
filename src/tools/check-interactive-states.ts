import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CDPConnection } from "../cdp/connection.js";

const DEFAULT_SELECTOR =
  "button, a, input, select, textarea, [role=\"button\"], [role=\"link\"], [tabindex]";

const VISUAL_PROPS = [
  "background",
  "background-color",
  "color",
  "border",
  "outline",
  "box-shadow",
  "text-decoration",
  "transform",
  "opacity",
];

const FOCUS_INDICATOR_PROPS = ["outline", "box-shadow", "border"];

const MAX_ELEMENTS = 50;

interface StyleMap {
  [prop: string]: string;
}

interface ElementResult {
  descriptor: string;
  hoverChanged: boolean;
  hoverDiffs: Array<{ prop: string; from: string; to: string }>;
  focusChanged: boolean;
  focusDiffs: Array<{ prop: string; from: string; to: string }>;
  focusHasIndicator: boolean;
}

function extractStyleMap(
  computedStyle: Array<{ name: string; value: string }>,
): StyleMap {
  const map: StyleMap = {};
  for (const { name, value } of computedStyle) {
    if (VISUAL_PROPS.includes(name)) {
      map[name] = value;
    }
  }
  return map;
}

function diffStyles(
  before: StyleMap,
  after: StyleMap,
): Array<{ prop: string; from: string; to: string }> {
  const diffs: Array<{ prop: string; from: string; to: string }> = [];
  for (const prop of VISUAL_PROPS) {
    const from = before[prop] ?? "";
    const to = after[prop] ?? "";
    if (from !== to) {
      diffs.push({ prop, from, to });
    }
  }
  return diffs;
}

function hasFocusIndicator(
  before: StyleMap,
  after: StyleMap,
): boolean {
  for (const prop of FOCUS_INDICATOR_PROPS) {
    const from = before[prop] ?? "";
    const to = after[prop] ?? "";
    if (from !== to) return true;
  }
  return false;
}

function buildDescriptor(
  localName: string,
  attributes: string[],
): string {
  let descriptor = localName;
  const attrMap: Record<string, string> = {};
  for (let i = 0; i < attributes.length; i += 2) {
    attrMap[attributes[i]] = attributes[i + 1];
  }
  if (attrMap["id"]) descriptor += `#${attrMap["id"]}`;
  if (attrMap["class"]) {
    const classes = attrMap["class"].trim().split(/\s+/);
    descriptor += classes.map(c => `.${c}`).join("");
  }
  return descriptor;
}

function formatResults(results: ElementResult[]): string {
  const lines: string[] = [];
  lines.push(`INTERACTIVE STATES CHECK: ${results.length} elements tested`);
  lines.push("");

  const hoverIssues = results.filter(r => !r.hoverChanged);
  const focusIssues = results.filter(r => !r.focusHasIndicator);
  const ok = results.filter(r => r.hoverChanged && r.focusHasIndicator);

  for (const r of hoverIssues) {
    lines.push("ISSUE: no visual feedback on hover");
    lines.push(`  element: ${r.descriptor}`);
    lines.push(`  normal → hover: IDENTICAL (no style change)`);
    lines.push(`  checked: ${VISUAL_PROPS.join(", ")}`);
    lines.push("");
  }

  for (const r of focusIssues) {
    lines.push("ISSUE: focus outline removed without replacement");
    lines.push(`  element: ${r.descriptor}`);
    for (const prop of FOCUS_INDICATOR_PROPS) {
      const diff = r.focusDiffs.find(d => d.prop === prop);
      if (diff) {
        lines.push(`  ${prop}: ${diff.from} → ${diff.to}`);
      } else {
        const normalVal = "(unchanged)";
        lines.push(`  ${prop}: ${normalVal} (no change)`);
      }
    }
    lines.push(`  → no visible focus indicator (WCAG 2.4.7 violation)`);
    lines.push("");
  }

  if (ok.length > 0) {
    lines.push(
      `OK: ${ok.length} element${ok.length !== 1 ? "s" : ""} have proper hover/focus feedback`,
    );
    lines.push("");
  }

  lines.push("SUMMARY:");
  lines.push(
    `  hover issues: ${hoverIssues.length} (no visual change on hover)`,
  );
  lines.push(
    `  focus issues: ${focusIssues.length} (no focus indicator)`,
  );

  return lines.join("\n");
}

export function registerCheckInteractiveStates(server: McpServer): void {
  server.tool(
    "check_interactive_states",
    `Check hover and focus states on interactive elements. Detects:
- Missing hover feedback: elements that look identical on hover (no visual change)
- Missing focus indicator: elements with no outline/box-shadow/border change on focus (WCAG 2.4.7)

Tests up to 50 elements by forcing :hover and :focus pseudo-states via CSS domain.

Example: check_interactive_states() — scans all buttons, links, inputs
Example: check_interactive_states({ selector: ".nav-link" }) — test specific elements`,
    {
      selector: z
        .string()
        .optional()
        .describe(
          "CSS selector to limit which elements to test (default: all interactive elements)",
        ),
      port: z
        .number()
        .optional()
        .describe("Chrome debugging port (default: 9222)"),
      host: z
        .string()
        .optional()
        .describe("Chrome debugging host (default: localhost)"),
    },
    async (params) => {
      let connection: CDPConnection | undefined;
      try {
        connection = await CDPConnection.connect({
          host: params.host,
          port: params.port,
        });
        const client = connection.client;

        const { root } = await client.DOM.getDocument({ depth: -1 });
        const selector = params.selector ?? DEFAULT_SELECTOR;
        const { nodeIds } = await client.DOM.querySelectorAll({
          nodeId: root.nodeId,
          selector,
        });

        const limited = nodeIds.slice(0, MAX_ELEMENTS);
        const results: ElementResult[] = [];

        for (const nodeId of limited) {
          let descriptor: string;
          try {
            const { node } = await client.DOM.describeNode({ nodeId });
            descriptor = buildDescriptor(
              node.localName,
              node.attributes ?? [],
            );
          } catch {
            descriptor = `(node ${nodeId})`;
          }

          try {
            const { computedStyle: normalStyle } =
              await client.CSS.getComputedStyleForNode({ nodeId });
            const normalMap = extractStyleMap(normalStyle);

            await client.CSS.forcePseudoState({
              nodeId,
              forcedPseudoClasses: ["hover"],
            });
            const { computedStyle: hoverStyle } =
              await client.CSS.getComputedStyleForNode({ nodeId });
            const hoverMap = extractStyleMap(hoverStyle);
            const hoverDiffs = diffStyles(normalMap, hoverMap);

            await client.CSS.forcePseudoState({
              nodeId,
              forcedPseudoClasses: ["focus"],
            });
            const { computedStyle: focusStyle } =
              await client.CSS.getComputedStyleForNode({ nodeId });
            const focusMap = extractStyleMap(focusStyle);
            const focusDiffs = diffStyles(normalMap, focusMap);
            const focusIndicator = hasFocusIndicator(normalMap, focusMap);

            await client.CSS.forcePseudoState({
              nodeId,
              forcedPseudoClasses: [],
            });

            results.push({
              descriptor,
              hoverChanged: hoverDiffs.length > 0,
              hoverDiffs,
              focusChanged: focusDiffs.length > 0,
              focusDiffs,
              focusHasIndicator: focusIndicator,
            });
          } catch {
            await client.CSS.forcePseudoState({
              nodeId,
              forcedPseudoClasses: [],
            }).catch(() => {});
          }
        }

        const text =
          results.length > 0
            ? formatResults(results)
            : `NO INTERACTIVE ELEMENTS FOUND\n\nNo elements matched selector: ${selector}`;

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
