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
  parsePx,
  walkTree,
} from "./types.js";

/**
 * Detects unexpected whitespace/gaps between elements.
 *
 * Checks:
 * - Large gaps between sibling elements without corresponding margin/padding
 * - Inline-block whitespace gaps
 * - Flex gap effective vs declared
 * - margin:auto creating unexpected spacing
 */
export class WhitespaceDetector implements Detector {
  readonly category: IssueCategory = "whitespace";

  detect(tree: LayoutTree): Issue[] {
    const issues: Issue[] = [];

    walkTree(tree, (node) => {
      this.checkSiblingGaps(node, tree, issues);
      this.checkFlexGapMismatch(node, tree, issues);
      this.checkMarginAutoSpacing(node, tree, issues);
    });

    return issues;
  }

  /**
   * Detect large unexplained gaps between sibling elements.
   */
  private checkSiblingGaps(
    parent: LayoutNode,
    tree: LayoutTree,
    issues: Issue[],
  ): void {
    if (parent.children.length < 2) return;

    // Skip flex/grid containers (they have their own gap mechanism)
    if (isFlexContainer(parent)) return;
    const d = parent.computed.display;
    if (d === "grid" || d === "inline-grid") return;

    for (let i = 0; i < parent.children.length - 1; i++) {
      const current = parent.children[i];
      const next = parent.children[i + 1];

      // Calculate actual vertical gap between siblings
      const currentBottom =
        current.boxModel.total.y + current.boxModel.total.height;
      const nextTop = next.boxModel.total.y;
      const actualGap = nextTop - currentBottom;

      // Skip if gap is small or negative (overlapping)
      if (actualGap < 20) continue;

      // Calculate expected gap from margins
      const bottomMargin = current.boxModel.margin.bottom;
      const topMargin = next.boxModel.margin.top;
      const expectedGap = Math.max(bottomMargin, topMargin); // Account for collapse

      // If the actual gap is significantly larger than expected margins
      const unexplainedGap = actualGap - expectedGap;
      if (unexplainedGap < 10) continue;

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

      // Check for inline-block whitespace issues
      if (
        current.computed.display === "inline-block" &&
        next.computed.display === "inline-block"
      ) {
        causeChain.push({
          element: parent.selector,
          property: "display",
          value: "inline-block siblings",
          explanation:
            "Inline-block elements have whitespace gaps from HTML formatting (spaces/newlines between elements)",
        });
      }

      causeChain.push({
        element: parent.selector,
        property: "gap",
        value: `actual: ${Math.round(actualGap)}px, expected: ${Math.round(expectedGap)}px`,
        explanation: `Unexplained gap of ${Math.round(unexplainedGap)}px between siblings`,
      });

      issues.push({
        category: this.category,
        severity: unexplainedGap > 50 ? "warning" : "info",
        summary: `Unexplained ${Math.round(unexplainedGap)}px gap between ${current.selector} and ${next.selector}`,
        element: parent,
        elementPath: getElementPath(parent, tree),
        causeChain,
        rootCause: {
          description: `There is a ${Math.round(actualGap)}px gap between elements but only ${Math.round(expectedGap)}px can be attributed to margins. The remaining ${Math.round(unexplainedGap)}px may come from padding, whitespace text nodes, or other layout effects.`,
        },
        relatedNodes: [current, next],
      });
    }
  }

  /**
   * Detect flex containers where the actual gap differs from the declared gap.
   */
  private checkFlexGapMismatch(
    node: LayoutNode,
    tree: LayoutTree,
    issues: Issue[],
  ): void {
    if (!isFlexContainer(node)) return;
    if (node.children.length < 2) return;

    const declaredGap = parsePx(node.computed.gap ?? "0");

    // Measure actual gap between first two children
    const isRow =
      node.computed.flexDirection === "row" ||
      node.computed.flexDirection === "row-reverse" ||
      node.computed.flexDirection === undefined;

    let actualGap: number;
    const first = node.children[0];
    const second = node.children[1];

    if (isRow) {
      const firstRight = first.boxModel.total.x + first.boxModel.total.width;
      actualGap = second.boxModel.total.x - firstRight;
    } else {
      const firstBottom = first.boxModel.total.y + first.boxModel.total.height;
      actualGap = second.boxModel.total.y - firstBottom;
    }

    const diff = Math.abs(actualGap - declaredGap);
    if (diff < 2) return; // Within rounding

    // Only flag if declared gap exists and differs
    if (declaredGap === 0 && actualGap < 10) return;

    const causeChain: CauseStep[] = [];

    if (declaredGap > 0) {
      causeChain.push({
        element: node.selector,
        property: "gap",
        value: node.computed.gap ?? "0",
        ruleSource: findRuleForProperty(node, "gap"),
        explanation: `Declared gap: ${node.computed.gap}`,
      });
    }

    causeChain.push({
      element: node.selector,
      property: "actual-gap",
      value: `${Math.round(actualGap)}px`,
      explanation: `Actual measured gap between first two children: ${Math.round(actualGap)}px`,
    });

    // Check if child margins contribute
    if (isRow) {
      const rightMargin = first.boxModel.margin.right;
      const leftMargin = second.boxModel.margin.left;
      if (rightMargin > 0 || leftMargin > 0) {
        causeChain.push({
          element: first.selector,
          property: "margin",
          value: `right: ${rightMargin}px`,
          explanation: `Child margins also contribute to the gap (${rightMargin}px + ${leftMargin}px)`,
        });
      }
    }

    issues.push({
      category: this.category,
      severity: "info",
      summary: `Flex gap mismatch: declared ${declaredGap}px, actual ${Math.round(actualGap)}px (diff: ${Math.round(diff)}px)`,
      element: node,
      elementPath: getElementPath(node, tree),
      causeChain,
      rootCause: {
        description: `The effective gap between flex items (${Math.round(actualGap)}px) differs from the declared gap (${declaredGap}px). This may be caused by child margins or padding.`,
        source: findRuleForProperty(node, "gap"),
      },
    });
  }

  /**
   * Detect margin: auto creating large unexpected spacing.
   */
  private checkMarginAutoSpacing(
    node: LayoutNode,
    tree: LayoutTree,
    issues: Issue[],
  ): void {
    // Check for margin:auto by looking at computed margins
    const marginRule = findRuleForProperty(node, "margin");
    const marginLeftRule = findRuleForProperty(node, "margin-left");
    const marginRightRule = findRuleForProperty(node, "margin-right");

    const hasAutoMargin =
      (marginRule && marginRule.value.includes("auto")) ||
      (marginLeftRule && marginLeftRule.value === "auto") ||
      (marginRightRule && marginRightRule.value === "auto");

    if (!hasAutoMargin) return;

    const leftMargin = node.boxModel.margin.left;
    const rightMargin = node.boxModel.margin.right;
    const totalAutoMargin = leftMargin + rightMargin;

    // Only flag if auto margins create significant spacing
    if (totalAutoMargin < 50) return;

    const causeChain: CauseStep[] = [];

    if (marginLeftRule && marginLeftRule.value === "auto") {
      causeChain.push({
        element: node.selector,
        property: "margin-left",
        value: `auto (computed: ${leftMargin}px)`,
        ruleSource: marginLeftRule,
        explanation: `margin-left: auto computes to ${leftMargin}px`,
      });
    }

    if (marginRightRule && marginRightRule.value === "auto") {
      causeChain.push({
        element: node.selector,
        property: "margin-right",
        value: `auto (computed: ${rightMargin}px)`,
        ruleSource: marginRightRule,
        explanation: `margin-right: auto computes to ${rightMargin}px`,
      });
    }

    if (causeChain.length === 0 && marginRule) {
      causeChain.push({
        element: node.selector,
        property: "margin",
        value: marginRule.value,
        ruleSource: marginRule,
        explanation: `margin: ${marginRule.value} creates ${totalAutoMargin}px of horizontal spacing`,
      });
    }

    issues.push({
      category: this.category,
      severity: "info",
      summary: `margin: auto creates ${totalAutoMargin}px of horizontal spacing (left: ${leftMargin}px, right: ${rightMargin}px)`,
      element: node,
      elementPath: getElementPath(node, tree),
      causeChain,
      rootCause: {
        description: `margin: auto distributes ${totalAutoMargin}px of available space as margins. This is typically intentional for centering.`,
        source: marginRule ?? marginLeftRule ?? marginRightRule,
      },
    });
  }
}
