import type {
  CauseStep,
  Detector,
  Issue,
  IssueCategory,
  LayoutNode,
  LayoutTree,
} from "../types.js";
import {
  findRuleForProperty,
  getElementPath,
  isFlexContainer,
  isGridContainer,
  walkTree,
} from "./types.js";

/**
 * Detects margin collapse issues between adjacent block elements.
 *
 * Checks:
 * - Adjacent vertical margins that collapse
 * - Compares declared margin sum vs actual gap
 * - Flags unexpected collapses (e.g., elements with border/padding between them)
 */
export class MarginCollapseDetector implements Detector {
  readonly category: IssueCategory = "margin-collapse";

  detect(tree: LayoutTree): Issue[] {
    const issues: Issue[] = [];

    walkTree(tree, (node) => {
      this.checkChildMarginCollapse(node, tree, issues);
    });

    return issues;
  }

  /**
   * Check adjacent children for margin collapse.
   */
  private checkChildMarginCollapse(
    parent: LayoutNode,
    tree: LayoutTree,
    issues: Issue[],
  ): void {
    // Margin collapse doesn't happen in flex/grid containers
    if (isFlexContainer(parent) || isGridContainer(parent)) return;

    // Need at least 2 children
    if (parent.children.length < 2) return;

    for (let i = 0; i < parent.children.length - 1; i++) {
      const current = parent.children[i];
      const next = parent.children[i + 1];

      // Only block-level elements participate in margin collapse
      if (!this.isBlockLevel(current) || !this.isBlockLevel(next)) continue;

      // Check vertical margin collapse
      const bottomMargin = current.boxModel.margin.bottom;
      const topMargin = next.boxModel.margin.top;

      if (bottomMargin <= 0 && topMargin <= 0) continue;

      // Calculate the expected gap (sum of margins) vs actual gap
      const expectedGap = bottomMargin + topMargin;
      const actualGap =
        next.boxModel.total.y -
        (current.boxModel.total.y + current.boxModel.total.height);

      // Account for rounding
      const collapsedAmount = expectedGap - actualGap;
      if (collapsedAmount < 1) continue;

      // Margin collapse is normal CSS. Only flag when both elements have
      // author-defined vertical margins — the dev set both values explicitly
      // and might not expect them to collapse.
      const currentHasAuthorMargin = this.hasAuthorVerticalMargin(current);
      const nextHasAuthorMargin = this.hasAuthorVerticalMargin(next);
      if (!currentHasAuthorMargin || !nextHasAuthorMargin) continue;

      // When both margins are identical, the collapse result equals either
      // value — visually indistinguishable from "no collapse". Skip these.
      if (bottomMargin === topMargin) continue;

      const severity = this.assessSeverity(
        collapsedAmount,
        expectedGap,
        parent,
      );

      const causeChain: CauseStep[] = [];

      causeChain.push({
        element: current.selector,
        property: "margin-bottom",
        value: `${bottomMargin}px`,
        ruleSource: findRuleForProperty(current, "margin-bottom") ?? findRuleForProperty(current, "margin"),
        explanation: `Bottom margin: ${bottomMargin}px`,
      });

      causeChain.push({
        element: next.selector,
        property: "margin-top",
        value: `${topMargin}px`,
        ruleSource: findRuleForProperty(next, "margin-top") ?? findRuleForProperty(next, "margin"),
        explanation: `Top margin: ${topMargin}px`,
      });

      causeChain.push({
        element: current.selector,
        property: "margin-collapse",
        value: `expected ${expectedGap}px, actual ${Math.round(actualGap)}px`,
        explanation: `Margins collapse: expected gap ${expectedGap}px (sum), actual gap ${Math.round(actualGap)}px (collapsed to ${Math.max(bottomMargin, topMargin)}px)`,
      });

      issues.push({
        category: this.category,
        severity,
        summary: `Margin collapse between ${current.selector} and ${next.selector}: ${expectedGap}px declared, ${Math.round(actualGap)}px actual (${Math.round(collapsedAmount)}px collapsed)`,
        element: current,
        elementPath: getElementPath(current, tree),
        causeChain,
        rootCause: {
          description: `Adjacent block-level margins collapse to ${Math.max(bottomMargin, topMargin)}px (the larger of ${bottomMargin}px and ${topMargin}px) instead of summing to ${expectedGap}px`,
        },
        relatedNodes: [next],
        impact: `The gap between these elements is ${Math.round(collapsedAmount)}px smaller than the sum of their declared margins`,
      });
    }
  }

  private isBlockLevel(node: LayoutNode): boolean {
    const { display, float: floatVal, position } = node.computed;

    // Floated or absolutely positioned elements don't participate in margin collapse
    if (floatVal !== "none") return false;
    if (position === "absolute" || position === "fixed") return false;

    // Block-level displays
    return (
      display === "block" ||
      display === "list-item" ||
      display === "table" ||
      display.startsWith("flow")
    );
  }

  private hasAuthorVerticalMargin(node: LayoutNode): boolean {
    const verticalProps = ["margin", "margin-top", "margin-bottom"];
    return node.rules.some(
      (r) =>
        !r.isUserAgent &&
        !r.isInherited &&
        verticalProps.includes(r.property) &&
        r.value !== "0" &&
        r.value !== "0px",
    );
  }

  private assessSeverity(
    collapsedAmount: number,
    expectedGap: number,
    parent: LayoutNode,
  ): "error" | "warning" | "info" {
    // If parent has padding or border that should prevent collapse but doesn't,
    // that's unusual
    const parentHasVerticalSeparation =
      parent.boxModel.padding.top > 0 ||
      parent.boxModel.padding.bottom > 0 ||
      parent.boxModel.border.top > 0 ||
      parent.boxModel.border.bottom > 0;

    if (parentHasVerticalSeparation && collapsedAmount > 0) {
      return "warning";
    }

    // Large collapse amount is more impactful
    if (collapsedAmount > 20 || collapsedAmount / expectedGap > 0.4) {
      return "warning";
    }

    return "info";
  }
}
