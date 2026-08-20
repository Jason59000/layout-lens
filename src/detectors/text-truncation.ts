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
  walkTree,
} from "./types.js";

/**
 * Detects text truncation issues.
 *
 * Checks:
 * - text-overflow: ellipsis + overflow: hidden + white-space: nowrap combo
 * - Elements where scrollWidth > clientWidth (content overflows)
 * - Estimates how much text is visible vs hidden
 */
export class TextTruncationDetector implements Detector {
  readonly category: IssueCategory = "text-truncation";

  detect(tree: LayoutTree): Issue[] {
    const issues: Issue[] = [];

    walkTree(tree, (node) => {
      this.checkEllipsisTruncation(node, tree, issues);
      this.checkOverflowingText(node, tree, issues);
    });

    return issues;
  }

  /**
   * Detect the classic ellipsis truncation pattern:
   * text-overflow: ellipsis + overflow: hidden + white-space: nowrap
   */
  private checkEllipsisTruncation(
    node: LayoutNode,
    tree: LayoutTree,
    issues: Issue[],
  ): void {
    const { computed, scroll } = node;

    if (computed.textOverflow !== "ellipsis") return;
    if (computed.overflowX !== "hidden" && computed.overflowX !== "clip") return;
    if (computed.whiteSpace !== "nowrap" && computed.whiteSpace !== "pre")
      return;

    // Check if text is actually truncated
    const isActuallyTruncated = scroll.scrollWidth > scroll.clientWidth;
    if (!isActuallyTruncated) return;

    const visiblePct =
      scroll.clientWidth > 0
        ? Math.round((scroll.clientWidth / scroll.scrollWidth) * 100)
        : 0;
    const hiddenPx = scroll.scrollWidth - scroll.clientWidth;

    const causeChain: CauseStep[] = [];

    causeChain.push({
      element: node.selector,
      property: "text-overflow",
      value: "ellipsis",
      ruleSource: findRuleForProperty(node, "text-overflow"),
      explanation: "text-overflow: ellipsis shows ... when text is clipped",
    });

    causeChain.push({
      element: node.selector,
      property: "overflow",
      value: computed.overflowX,
      ruleSource:
        findRuleForProperty(node, "overflow-x") ??
        findRuleForProperty(node, "overflow"),
      explanation: `overflow: ${computed.overflowX} clips the overflowing content`,
    });

    causeChain.push({
      element: node.selector,
      property: "white-space",
      value: computed.whiteSpace,
      ruleSource: findRuleForProperty(node, "white-space"),
      explanation: `white-space: ${computed.whiteSpace} prevents text from wrapping`,
    });

    // Check if a fixed width is constraining
    if (
      computed.width &&
      computed.width !== "auto" &&
      !computed.width.endsWith("%")
    ) {
      causeChain.push({
        element: node.selector,
        property: "width",
        value: computed.width,
        ruleSource: findRuleForProperty(node, "width"),
        explanation: `Fixed width ${computed.width} constrains the text`,
      });
    }

    if (computed.maxWidth && computed.maxWidth !== "none") {
      causeChain.push({
        element: node.selector,
        property: "max-width",
        value: computed.maxWidth,
        ruleSource: findRuleForProperty(node, "max-width"),
        explanation: `max-width ${computed.maxWidth} constrains the text`,
      });
    }

    issues.push({
      category: this.category,
      severity: "warning",
      summary: `Text truncated with ellipsis: ~${visiblePct}% visible (${hiddenPx}px hidden)`,
      element: node,
      elementPath: getElementPath(node, tree),
      causeChain,
      rootCause: {
        description: `Text is truncated by text-overflow: ellipsis. ${visiblePct}% of content is visible, ${hiddenPx}px is hidden.`,
        source: findRuleForProperty(node, "text-overflow"),
      },
      impact: `Approximately ${100 - visiblePct}% of the text content is hidden behind an ellipsis`,
    });
  }

  /**
   * Detect text that overflows its container without ellipsis
   * (text is simply clipped or bleeds out).
   */
  private checkOverflowingText(
    node: LayoutNode,
    tree: LayoutTree,
    issues: Issue[],
  ): void {
    const { computed, scroll } = node;

    // Skip if already handled by ellipsis check
    if (computed.textOverflow === "ellipsis") return;

    // Only check elements that might contain text
    // (not containers with many children)
    if (node.children.length > 3) return;

    // Check for text overflow
    if (scroll.scrollWidth <= scroll.clientWidth || scroll.clientWidth === 0)
      return;

    // Must have white-space: nowrap or similar to be text-specific
    if (computed.whiteSpace !== "nowrap" && computed.whiteSpace !== "pre")
      return;

    // Must have overflow: hidden for the text to actually be clipped without indicator
    if (computed.overflowX !== "hidden" && computed.overflowX !== "clip")
      return;

    const hiddenPx = scroll.scrollWidth - scroll.clientWidth;
    const causeChain: CauseStep[] = [];

    causeChain.push({
      element: node.selector,
      property: "white-space",
      value: computed.whiteSpace,
      ruleSource: findRuleForProperty(node, "white-space"),
      explanation: `white-space: ${computed.whiteSpace} prevents wrapping`,
    });

    causeChain.push({
      element: node.selector,
      property: "overflow",
      value: computed.overflowX,
      ruleSource:
        findRuleForProperty(node, "overflow-x") ??
        findRuleForProperty(node, "overflow"),
      explanation: `overflow: ${computed.overflowX} clips the text without any indicator`,
    });

    issues.push({
      category: this.category,
      severity: "error",
      summary: `Text is clipped without ellipsis indicator (${hiddenPx}px hidden)`,
      element: node,
      elementPath: getElementPath(node, tree),
      causeChain,
      rootCause: {
        description: `Text is clipped by overflow: ${computed.overflowX} with no text-overflow: ellipsis. Users cannot see that content is hidden.`,
        source:
          findRuleForProperty(node, "overflow-x") ??
          findRuleForProperty(node, "overflow"),
      },
      impact:
        "Text content is silently clipped with no visual indicator. Users may miss important information.",
    });
  }
}
