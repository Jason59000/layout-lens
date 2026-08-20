import type {
  CauseStep,
  Detector,
  Issue,
  IssueCategory,
  IssueSeverity,
  LayoutNode,
  LayoutTree,
} from "../types.js";
import {
  findRuleForProperty,
  getElementPath,
  walkTree,
} from "./types.js";

/**
 * Detects horizontal/vertical overflow and viewport protrusion.
 *
 * Checks:
 * - scrollWidth > clientWidth (horizontal overflow)
 * - scrollHeight > clientHeight (vertical overflow)
 * - Element wider than viewport
 * - Distinguishes clipped vs scrollable vs bleeding overflow
 * - Builds cause chain identifying the CSS property responsible
 */
export class OverflowDetector implements Detector {
  readonly category: IssueCategory = "overflow";

  detect(tree: LayoutTree): Issue[] {
    const issues: Issue[] = [];

    walkTree(tree, (node, parent) => {
      this.checkHorizontalOverflow(node, parent, tree, issues);
      this.checkVerticalOverflow(node, parent, tree, issues);
      this.checkViewportProtrusion(node, tree, issues);
    });

    return issues;
  }

  private checkHorizontalOverflow(
    node: LayoutNode,
    parent: LayoutNode | undefined,
    tree: LayoutTree,
    issues: Issue[],
  ): void {
    const { scroll, computed } = node;
    if (scroll.scrollWidth <= scroll.clientWidth || scroll.clientWidth === 0)
      return;

    const overflowBehavior = this.classifyOverflow(computed.overflowX);
    const severity = this.severityForBehavior(overflowBehavior);
    const causeChain = this.buildHorizontalCauseChain(node, parent);

    issues.push({
      category: this.category,
      severity,
      summary: `Horizontal overflow (${overflowBehavior}): scrollWidth ${scroll.scrollWidth}px > clientWidth ${scroll.clientWidth}px`,
      element: node,
      elementPath: getElementPath(node, tree),
      causeChain,
      rootCause: {
        description:
          causeChain.length > 0
            ? causeChain[causeChain.length - 1].explanation
            : `Content overflows horizontally (${overflowBehavior})`,
        source: causeChain.length > 0 ? causeChain[causeChain.length - 1].ruleSource : undefined,
      },
    });
  }

  private checkVerticalOverflow(
    node: LayoutNode,
    parent: LayoutNode | undefined,
    tree: LayoutTree,
    issues: Issue[],
  ): void {
    const { scroll, computed } = node;
    if (scroll.scrollHeight <= scroll.clientHeight || scroll.clientHeight === 0)
      return;

    const overflowBehavior = this.classifyOverflow(computed.overflowY);
    // Vertical scroll is often intentional (e.g., body scroll)
    if (overflowBehavior === "scrollable" && node.tag === "body") return;
    if (overflowBehavior === "scrollable" && node.tag === "html") return;

    const severity: IssueSeverity =
      overflowBehavior === "bleeds" ? "warning" : "info";
    const causeChain = this.buildVerticalCauseChain(node, parent);

    issues.push({
      category: this.category,
      severity,
      summary: `Vertical overflow (${overflowBehavior}): scrollHeight ${scroll.scrollHeight}px > clientHeight ${scroll.clientHeight}px`,
      element: node,
      elementPath: getElementPath(node, tree),
      causeChain,
      rootCause: {
        description:
          causeChain.length > 0
            ? causeChain[causeChain.length - 1].explanation
            : `Content overflows vertically (${overflowBehavior})`,
        source: causeChain.length > 0 ? causeChain[causeChain.length - 1].ruleSource : undefined,
      },
    });
  }

  private checkViewportProtrusion(
    node: LayoutNode,
    tree: LayoutTree,
    issues: Issue[],
  ): void {
    const { boxModel } = node;
    const { viewport } = tree;
    const totalRight = boxModel.total.x + boxModel.total.width;

    if (totalRight > viewport.width && boxModel.total.width > 0) {
      const causeChain: CauseStep[] = [];
      const widthRule = findRuleForProperty(node, "width");
      const minWidthRule = findRuleForProperty(node, "min-width");

      if (widthRule && widthRule.value !== "auto") {
        causeChain.push({
          element: node.selector,
          property: "width",
          value: widthRule.value,
          ruleSource: widthRule,
          explanation: `Element has fixed width ${widthRule.value} that exceeds viewport width ${viewport.width}px`,
        });
      }
      if (minWidthRule && minWidthRule.value !== "0px") {
        causeChain.push({
          element: node.selector,
          property: "min-width",
          value: minWidthRule.value,
          ruleSource: minWidthRule,
          explanation: `Element has min-width ${minWidthRule.value} that may exceed viewport`,
        });
      }

      if (causeChain.length === 0) {
        causeChain.push({
          element: node.selector,
          property: "box-model",
          value: `${boxModel.total.width}px`,
          explanation: `Element total width (${boxModel.total.width}px) protrudes beyond viewport (${viewport.width}px)`,
        });
      }

      issues.push({
        category: this.category,
        severity: "error",
        summary: `Element protrudes beyond viewport: ${Math.round(totalRight - viewport.width)}px past right edge`,
        element: node,
        elementPath: getElementPath(node, tree),
        causeChain,
        rootCause: {
          description: causeChain[causeChain.length - 1].explanation,
          source: causeChain[causeChain.length - 1].ruleSource,
        },
      });
    }
  }

  private classifyOverflow(
    overflowValue: string,
  ): "clipped" | "scrollable" | "bleeds" {
    switch (overflowValue) {
      case "hidden":
      case "clip":
        return "clipped";
      case "auto":
      case "scroll":
        return "scrollable";
      default:
        return "bleeds";
    }
  }

  private severityForBehavior(
    behavior: "clipped" | "scrollable" | "bleeds",
  ): IssueSeverity {
    switch (behavior) {
      case "bleeds":
        return "error";
      case "clipped":
        return "warning";
      case "scrollable":
        return "info";
    }
  }

  private buildHorizontalCauseChain(
    node: LayoutNode,
    _parent: LayoutNode | undefined,
  ): CauseStep[] {
    const chain: CauseStep[] = [];
    const { computed } = node;

    // Check white-space: nowrap
    if (computed.whiteSpace === "nowrap") {
      const rule = findRuleForProperty(node, "white-space");
      chain.push({
        element: node.selector,
        property: "white-space",
        value: "nowrap",
        ruleSource: rule,
        explanation:
          "white-space: nowrap prevents text from wrapping, causing horizontal overflow",
      });
    }

    // Check fixed width
    if (
      computed.width &&
      computed.width !== "auto" &&
      !computed.width.endsWith("%")
    ) {
      const rule = findRuleForProperty(node, "width");
      if (rule && !rule.isUserAgent) {
        chain.push({
          element: node.selector,
          property: "width",
          value: computed.width,
          ruleSource: rule,
          explanation: `Fixed width ${computed.width} may prevent content from fitting`,
        });
      }
    }

    // Check min-width
    if (computed.minWidth && computed.minWidth !== "0px" && computed.minWidth !== "auto") {
      const rule = findRuleForProperty(node, "min-width");
      chain.push({
        element: node.selector,
        property: "min-width",
        value: computed.minWidth,
        ruleSource: rule,
        explanation: `min-width ${computed.minWidth} forces element to be at least this wide`,
      });
    }

    // Fallback
    if (chain.length === 0) {
      chain.push({
        element: node.selector,
        property: "overflow-x",
        value: computed.overflowX,
        explanation: `Content is wider than the container (scrollWidth: ${node.scroll.scrollWidth}px vs clientWidth: ${node.scroll.clientWidth}px)`,
      });
    }

    return chain;
  }

  private buildVerticalCauseChain(
    node: LayoutNode,
    _parent: LayoutNode | undefined,
  ): CauseStep[] {
    const chain: CauseStep[] = [];
    const { computed } = node;

    // Check fixed height
    if (
      computed.height &&
      computed.height !== "auto" &&
      !computed.height.endsWith("%")
    ) {
      const rule = findRuleForProperty(node, "height");
      if (rule && !rule.isUserAgent) {
        chain.push({
          element: node.selector,
          property: "height",
          value: computed.height,
          ruleSource: rule,
          explanation: `Fixed height ${computed.height} constrains the container while content exceeds it`,
        });
      }
    }

    // Check max-height
    if (computed.maxHeight && computed.maxHeight !== "none") {
      const rule = findRuleForProperty(node, "max-height");
      chain.push({
        element: node.selector,
        property: "max-height",
        value: computed.maxHeight,
        ruleSource: rule,
        explanation: `max-height ${computed.maxHeight} constrains the container`,
      });
    }

    if (chain.length === 0) {
      chain.push({
        element: node.selector,
        property: "overflow-y",
        value: computed.overflowY,
        explanation: `Content is taller than the container (scrollHeight: ${node.scroll.scrollHeight}px vs clientHeight: ${node.scroll.clientHeight}px)`,
      });
    }

    return chain;
  }
}
