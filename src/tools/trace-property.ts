import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CDPConnection } from "../cdp/connection.js";

function extractMediaQuery(rule: { media?: Array<{ text: string }> }): string | undefined {
  if (!rule.media || rule.media.length === 0) return undefined;
  const queries = rule.media
    .filter(m => m.text && m.text !== "all")
    .map(m => m.text);
  return queries.length > 0 ? queries.join(" and ") : undefined;
}

function extractContainerQuery(rule: { containerQueries?: Array<{ text: string }> }): string | undefined {
  if (!rule.containerQueries || rule.containerQueries.length === 0) return undefined;
  return rule.containerQueries.map(c => c.text).join(", ");
}

function isVendorPrefix(name: string): boolean {
  if (!name.startsWith("-")) return false;
  if (name.startsWith("--")) return false;
  return true;
}

interface CascadeEntry {
  selector: string;
  value: string;
  important: boolean;
  sourceFile?: string;
  sourceLine?: number;
  isInline: boolean;
  isInherited: boolean;
  isUserAgent: boolean;
  mediaQuery?: string;
  containerQuery?: string;
}

export function registerTraceProperty(server: McpServer): void {
  server.tool(
    "trace_property",
    `Trace the CSS cascade for a specific property on an element. Shows all rules that declare this property, ordered by Blink's own cascade resolution. The computed value comes from Chrome — no heuristic recomputation.

Uses CSS.getMatchedStylesForNode (Blink's matched rules), CSS.getComputedStyleForNode (ground truth), and CSS.resolveValues (resolve calc/em/%/var).`,
    {
      selector: z.string().describe("CSS selector to find the element"),
      property: z.string().describe("CSS property to trace (e.g. 'min-width', 'z-index', 'display')"),
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

        const client = connection.client;
        await client.DOM.enable();
        await client.CSS.enable();

        const { root: docRoot } = await client.DOM.getDocument({ depth: 0 });
        const { nodeId } = await client.DOM.querySelector({
          nodeId: docRoot.nodeId,
          selector: params.selector,
        });

        if (!nodeId) {
          return {
            content: [{ type: "text", text: `Element not found: "${params.selector}". Try a different selector.` }],
            isError: true,
          };
        }

        const { node: nodeDesc } = await client.DOM.describeNode({ nodeId });
        let elementLabel = nodeDesc.localName || nodeDesc.nodeName.toLowerCase();
        const attrs = nodeDesc.attributes || [];
        for (let i = 0; i < attrs.length; i += 2) {
          if (attrs[i] === "id") elementLabel += `#${attrs[i + 1]}`;
          if (attrs[i] === "class") {
            const cls = attrs[i + 1].split(/\s+/).filter(Boolean);
            if (cls.length > 0) elementLabel += cls.map(c => `.${c}`).join("");
          }
        }

        const stylesheetSources = new Map<string, string>();
        const unsub = client.CSS.styleSheetAdded((p: { header: { styleSheetId: string; sourceURL?: string } }) => {
          if (p.header.sourceURL) stylesheetSources.set(p.header.styleSheetId, p.header.sourceURL);
        });
        await new Promise<void>(r => setTimeout(r, 50));
        unsub();

        const [matched, computedResult] = await Promise.all([
          client.CSS.getMatchedStylesForNode({ nodeId }),
          client.CSS.getComputedStyleForNode({ nodeId }),
        ]);

        const computedMap = new Map<string, string>();
        for (const p of computedResult.computedStyle) {
          computedMap.set(p.name, p.value);
        }
        const computedValue = computedMap.get(params.property) ?? "(not set)";

        const entries: CascadeEntry[] = [];
        const prop = params.property;

        if (matched.inlineStyle) {
          for (const p of matched.inlineStyle.cssProperties) {
            if (p.disabled || p.name !== prop) continue;
            entries.push({
              selector: "inline",
              value: p.value,
              important: p.important ?? false,
              isInline: true,
              isInherited: false,
              isUserAgent: false,
            });
          }
        }

        if (matched.matchedCSSRules) {
          for (const ruleMatch of matched.matchedCSSRules) {
            const { rule } = ruleMatch;
            const selectorText = rule.selectorList.text;
            const isUserAgent = rule.origin === "user-agent";

            let sourceFile: string | undefined;
            let sourceLine: number | undefined;
            if (rule.styleSheetId) {
              sourceFile = stylesheetSources.get(rule.styleSheetId);
            }
            if (rule.style.range) {
              sourceLine = rule.style.range.startLine;
            }

            const mediaQuery = extractMediaQuery(rule);
            const containerQuery = extractContainerQuery(rule);

            for (const p of rule.style.cssProperties) {
              if (p.disabled || isVendorPrefix(p.name) || p.name !== prop) continue;
              if (!p.value || p.value === "") continue;

              entries.push({
                selector: selectorText,
                value: p.value,
                important: p.important ?? false,
                sourceFile,
                sourceLine,
                isInline: false,
                isInherited: false,
                isUserAgent,
                mediaQuery,
                containerQuery,
              });
            }
          }
        }

        if (matched.inherited) {
          for (const inherited of matched.inherited) {
            if (inherited.inlineStyle) {
              for (const p of inherited.inlineStyle.cssProperties) {
                if (p.disabled || p.name !== prop) continue;
                entries.push({
                  selector: "inline (inherited)",
                  value: p.value,
                  important: p.important ?? false,
                  isInline: true,
                  isInherited: true,
                  isUserAgent: false,
                });
              }
            }

            for (const ruleMatch of inherited.matchedCSSRules) {
              const { rule } = ruleMatch;
              const selectorText = rule.selectorList.text;
              const isUserAgent = rule.origin === "user-agent";
              const mediaQuery = extractMediaQuery(rule);
              const containerQuery = extractContainerQuery(rule);

              let sourceFile: string | undefined;
              let sourceLine: number | undefined;
              if (rule.styleSheetId) {
                sourceFile = stylesheetSources.get(rule.styleSheetId);
              }
              if (rule.style.range) {
                sourceLine = rule.style.range.startLine;
              }

              for (const p of rule.style.cssProperties) {
                if (p.disabled || isVendorPrefix(p.name) || p.name !== prop) continue;
                if (!p.value || p.value === "") continue;

                entries.push({
                  selector: selectorText,
                  value: p.value,
                  important: p.important ?? false,
                  sourceFile,
                  sourceLine,
                  isInline: false,
                  isInherited: true,
                  isUserAgent,
                  mediaQuery,
                  containerQuery,
                });
              }
            }
          }
        }

        const lines: string[] = [];
        lines.push(`CSS CASCADE: ${prop}`);
        lines.push(`element: ${elementLabel}`);
        lines.push("");

        if (entries.length === 0) {
          lines.push("No CSS rules found for this property.");
          lines.push(`Computed value: ${computedValue}`);
        } else {
          const winner = entries[entries.length - 1];
          const isWinnerImportant = entries.some(e => e.important);

          for (let i = entries.length - 1; i >= 0; i--) {
            const e = entries[i];
            let label: string;
            if (i === entries.length - 1 && !e.isInherited) {
              label = "WINNING";
            } else if (e.isUserAgent) {
              label = "USER-AGENT";
            } else if (e.isInherited) {
              label = "INHERITED";
            } else {
              label = "OVERRIDDEN";
            }

            const importantMark = e.important ? " !important" : "";
            let line = `  ${label}: ${e.selector} { ${prop}: ${e.value}${importantMark} }`;

            if (!e.isUserAgent) {
              const meta: string[] = [];
              if (e.sourceFile) {
                const filename = e.sourceFile.split("/").pop() ?? e.sourceFile;
                meta.push(e.sourceLine !== undefined ? `${filename}:${e.sourceLine}` : filename);
              }
              if (e.isInherited) meta.push("inherited");
              if (e.mediaQuery) meta.push(`@media ${e.mediaQuery}`);
              if (e.containerQuery) meta.push(`@container ${e.containerQuery}`);
              if (meta.length > 0) line += `  (${meta.join(", ")})`;
            }

            lines.push(line);
          }

          lines.push("");
          lines.push(`Computed value: ${computedValue}`);

          try {
            const resolved = await (client.CSS as any).resolveValues({
              nodeId,
              values: [computedValue],
            });
            if (resolved.results && resolved.results.length > 0 && resolved.results[0] !== computedValue) {
              lines.push(`Resolved value: ${resolved.results[0]}`);
            }
          } catch {
            // CSS.resolveValues may not be available
          }
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
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
