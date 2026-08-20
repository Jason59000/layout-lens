import type { CSSRuleSource, LayoutNode } from "../types.js";

/**
 * Set of CSS properties that are inherited by default.
 * Used to determine whether to look at inherited rules
 * when a property is not found on the element itself.
 */
const INHERITED_PROPERTIES = new Set([
  "color",
  "cursor",
  "direction",
  "font",
  "font-family",
  "font-size",
  "font-style",
  "font-variant",
  "font-weight",
  "letter-spacing",
  "line-height",
  "list-style",
  "list-style-image",
  "list-style-position",
  "list-style-type",
  "orphans",
  "quotes",
  "text-align",
  "text-indent",
  "text-transform",
  "visibility",
  "white-space",
  "widows",
  "word-spacing",
  "word-wrap",
  "word-break",
]);

/**
 * Compare two specificity tuples.
 * Returns a positive number if `a` is more specific than `b`,
 * negative if less specific, 0 if equal.
 */
function compareSpecificity(
  a: [number, number, number],
  b: [number, number, number],
): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

/**
 * Check if a CSS value contains !important.
 */
function isImportant(value: string): boolean {
  return value.includes("!important");
}

/**
 * Strip !important from a value for display purposes.
 */
function stripImportant(value: string): string {
  return value.replace(/\s*!important\s*/g, "").trim();
}

/**
 * Format a specificity tuple as a string like "0-1-0".
 */
function formatSpecificity(spec: [number, number, number]): string {
  return `${spec[0]}-${spec[1]}-${spec[2]}`;
}

/**
 * Format a source location as a readable string.
 * Returns something like "styles.css:45" or undefined if no source info.
 */
function formatSourceLocation(rule: CSSRuleSource): string | undefined {
  if (!rule.sourceFile) return undefined;

  // Extract just the filename from the full URL/path
  const filename = rule.sourceFile.split("/").pop() ?? rule.sourceFile;

  if (rule.sourceLine !== undefined) {
    return `${filename}:${rule.sourceLine}`;
  }
  return filename;
}

/**
 * RuleTracer resolves which CSS rule "wins" for a given property
 * on a LayoutNode, and provides the full cascade chain ordered
 * by specificity for LLM consumption.
 */
export class RuleTracer {
  /**
   * For a property on a node, find the CSS rule that "wins" the cascade.
   *
   * Priority order:
   * 1. !important declarations (highest specificity wins among them)
   * 2. Inline styles
   * 3. Rules sorted by specificity (id > class > type)
   * 4. Inherited rules (only for inheritable properties)
   *
   * User-agent rules are deprioritized: a non-UA rule always wins
   * over a UA rule at the same specificity level.
   */
  traceProperty(node: LayoutNode, property: string): CSSRuleSource | undefined {
    const cascade = this.tracePropertyCascade(node, property);
    return cascade.length > 0 ? cascade[0] : undefined;
  }

  /**
   * Return all rules that touch a given property on a node,
   * sorted by cascade priority (winner first).
   *
   * The cascade is ordered:
   * 1. !important non-UA rules (highest specificity first)
   * 2. !important UA rules (highest specificity first)
   * 3. Non-UA rules by specificity (inline first, then id > class > type)
   * 4. UA rules by specificity
   * 5. Inherited rules (same ordering within)
   */
  tracePropertyCascade(node: LayoutNode, property: string): CSSRuleSource[] {
    // Gather local rules for this property
    const localRules = node.rules.filter(
      (r) => r.property === property && !r.isInherited,
    );

    // Gather inherited rules (only relevant for inheritable properties
    // or if no local rules exist)
    const inheritedRules = node.rules.filter(
      (r) => r.property === property && r.isInherited,
    );

    // If no local rules and the property is inheritable, use inherited rules
    const useInherited =
      localRules.length === 0 && INHERITED_PROPERTIES.has(property);

    const allRules = useInherited
      ? [...localRules, ...inheritedRules]
      : localRules.length > 0
        ? [...localRules, ...inheritedRules]
        : [...localRules, ...inheritedRules];

    return this.sortByCascade(allRules);
  }

  /**
   * Format a cascade of rules into a human-readable string for the LLM.
   *
   * Output format:
   * ```
   * property: min-width
   *   WINNING: .data-table { min-width: 1904px }  (styles.css:45, specificity: 0-1-0)
   *   OVERRIDDEN: .table { min-width: 100% }  (base.css:12, specificity: 0-1-0)
   *   USER-AGENT: table { min-width: auto }
   * ```
   */
  formatCascade(rules: CSSRuleSource[], winningValue: string): string {
    if (rules.length === 0) {
      return `property: (no matching rules found, computed value: ${winningValue})`;
    }

    const property = rules[0].property;
    const lines: string[] = [`property: ${property}`];

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      const label = this.getRuleLabel(rule, i);
      const value = stripImportant(rule.value);
      const important = isImportant(rule.value) ? " !important" : "";
      const source = formatSourceLocation(rule);
      const specificity = formatSpecificity(rule.specificity);

      let line = `  ${label}: ${rule.selector} { ${property}: ${value}${important} }`;

      if (rule.isUserAgent) {
        // User-agent rules don't show specificity or source
        lines.push(line);
      } else {
        const meta: string[] = [];
        if (source) meta.push(source);
        meta.push(`specificity: ${specificity}`);
        if (rule.isInherited) meta.push("inherited");
        line += `  (${meta.join(", ")})`;
        lines.push(line);
      }
    }

    return lines.join("\n");
  }

  /**
   * Sort rules by CSS cascade priority (winner first).
   */
  private sortByCascade(rules: CSSRuleSource[]): CSSRuleSource[] {
    return [...rules].sort((a, b) => {
      // 1. !important always wins
      const aImportant = isImportant(a.value);
      const bImportant = isImportant(b.value);
      if (aImportant && !bImportant) return -1;
      if (!aImportant && bImportant) return 1;

      // 2. Non-inherited beats inherited
      if (!a.isInherited && b.isInherited) return -1;
      if (a.isInherited && !b.isInherited) return 1;

      // 3. Non-UA beats UA
      if (!a.isUserAgent && b.isUserAgent) return -1;
      if (a.isUserAgent && !b.isUserAgent) return 1;

      // 4. Inline beats non-inline
      if (a.isInline && !b.isInline) return -1;
      if (!a.isInline && b.isInline) return 1;

      // 5. Higher specificity wins
      const specDiff = compareSpecificity(a.specificity, b.specificity);
      if (specDiff !== 0) return -specDiff; // negate because higher = first

      // 6. Later declaration wins (later in the array = later in source)
      // We rely on the original array order from CDP, so we preserve it
      return 0;
    });
  }

  /**
   * Get the display label for a rule in the cascade output.
   */
  private getRuleLabel(rule: CSSRuleSource, index: number): string {
    if (rule.isUserAgent) return "USER-AGENT";
    if (rule.isInherited) return "INHERITED";
    if (index === 0) return "WINNING";
    return "OVERRIDDEN";
  }
}
