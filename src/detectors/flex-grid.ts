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
  parsePx,
  walkTree,
} from "./types.js";

/**
 * Detects flex and grid layout anomalies.
 *
 * Checks:
 * - Flex item shrinking below its content (flex-shrink + min-width: auto)
 * - Unexpected flex wrap
 * - Grid items overflowing their track
 * - min-width: auto on flex items (common overflow cause)
 */
export class FlexGridDetector implements Detector {
  readonly category: IssueCategory = "flex-grid";

  detect(tree: LayoutTree): Issue[] {
    const issues: Issue[] = [];

    walkTree(tree, (node) => {
      if (isFlexContainer(node)) {
        this.checkFlexShrinkOverflow(node, tree, issues);
        this.checkMinWidthAuto(node, tree, issues);
        this.checkUnexpectedWrap(node, tree, issues);
      }
      if (isGridContainer(node)) {
        this.checkGridOverflow(node, tree, issues);
      }
    });

    return issues;
  }

  /**
   * Detect flex items that shrink below their content because of
   * flex-shrink > 0 combined with min-width: auto.
   */
  private checkFlexShrinkOverflow(
    container: LayoutNode,
    tree: LayoutTree,
    issues: Issue[],
  ): void {
    for (const child of container.children) {
      const shrink = child.computed.flexShrink;
      const shrinkVal = shrink !== undefined ? parseFloat(shrink) : 1;
      if (shrinkVal <= 0) continue;

      // Check if the item's content overflows
      if (
        child.scroll.scrollWidth <= child.scroll.clientWidth &&
        child.scroll.scrollHeight <= child.scroll.clientHeight
      ) {
        continue;
      }

      // Check for min-width: auto which is the default and allows shrinking past content
      const minWidth = child.computed.minWidth;
      const isMinWidthAuto = minWidth === "auto" || minWidth === "0px";

      if (!isMinWidthAuto) continue;

      const causeChain: CauseStep[] = [];

      causeChain.push({
        element: child.selector,
        property: "flex-shrink",
        value: String(shrinkVal),
        ruleSource: findRuleForProperty(child, "flex-shrink"),
        explanation: `flex-shrink: ${shrinkVal} allows the item to shrink`,
      });

      causeChain.push({
        element: child.selector,
        property: "min-width",
        value: minWidth,
        ruleSource: findRuleForProperty(child, "min-width"),
        explanation:
          "min-width: auto (default) allows the item to shrink below its content size, causing overflow",
      });

      causeChain.push({
        element: container.selector,
        property: "display",
        value: container.computed.display,
        ruleSource: findRuleForProperty(container, "display"),
        explanation: `Parent is a flex container (${container.computed.display})`,
      });

      issues.push({
        category: this.category,
        severity: "warning",
        summary: `Flex item content overflows because it shrinks below its content size`,
        element: child,
        elementPath: getElementPath(child, tree),
        causeChain,
        rootCause: {
          description:
            "Flex item shrinks below its content due to flex-shrink > 0 and min-width: auto. Set min-width: 0 or overflow: hidden on the item.",
          source: findRuleForProperty(child, "flex-shrink"),
        },
        relatedNodes: [container],
        impact: "Content inside this flex item is being clipped or overflows its bounds",
      });
    }
  }

  /**
   * Detect min-width: auto on flex items, which is a common source of overflow.
   * This flags the specific case where the auto min-width is larger than expected.
   */
  private checkMinWidthAuto(
    container: LayoutNode,
    tree: LayoutTree,
    issues: Issue[],
  ): void {
    const isRow =
      container.computed.flexDirection === "row" ||
      container.computed.flexDirection === "row-reverse" ||
      container.computed.flexDirection === undefined;

    if (!isRow) return;

    for (const child of container.children) {
      const minWidth = child.computed.minWidth;
      if (minWidth !== "auto") continue;

      // Only flag if the child is wider than the container
      if (child.boxModel.total.width <= container.boxModel.content.width)
        continue;

      const causeChain: CauseStep[] = [
        {
          element: child.selector,
          property: "min-width",
          value: "auto",
          explanation: `min-width: auto on a flex item defaults to the item's content size (${child.boxModel.content.width}px), which exceeds the container width (${container.boxModel.content.width}px)`,
        },
        {
          element: container.selector,
          property: "display",
          value: container.computed.display,
          ruleSource: findRuleForProperty(container, "display"),
          explanation: "Parent is a flex container",
        },
      ];

      issues.push({
        category: this.category,
        severity: "warning",
        summary: `Flex item exceeds container width due to min-width: auto`,
        element: child,
        elementPath: getElementPath(child, tree),
        causeChain,
        rootCause: {
          description:
            "min-width: auto on flex items prevents them from shrinking below their content size. Use min-width: 0 to allow shrinking.",
        },
        relatedNodes: [container],
      });
    }
  }

  /**
   * Detect unexpected flex wrapping: items wrap even though
   * the sum of their min-widths fits the container.
   */
  private checkUnexpectedWrap(
    container: LayoutNode,
    tree: LayoutTree,
    issues: Issue[],
  ): void {
    const wrap = container.computed.flexWrap;
    if (wrap !== "wrap" && wrap !== "wrap-reverse") return;

    const isRow =
      container.computed.flexDirection === "row" ||
      container.computed.flexDirection === "row-reverse" ||
      container.computed.flexDirection === undefined;

    if (!isRow) return;

    // Check if items actually wrap (are there items on different y positions?)
    if (container.children.length < 2) return;

    const firstY = container.children[0].boxModel.total.y;
    const hasWrapped = container.children.some(
      (child) => Math.abs(child.boxModel.total.y - firstY) > 1,
    );

    if (!hasWrapped) return;

    // Sum of min-widths (or actual widths for items without min-width)
    let totalMinWidth = 0;
    for (const child of container.children) {
      const minW = child.computed.minWidth;
      if (minW && minW !== "auto" && minW !== "0px") {
        totalMinWidth += parsePx(minW);
      } else {
        totalMinWidth += child.boxModel.content.width;
      }
    }

    // Account for gap
    const gap = parsePx(container.computed.gap ?? "0");
    const totalWithGap =
      totalMinWidth + gap * (container.children.length - 1);

    const containerWidth = container.boxModel.content.width;

    // Only flag if items *should* fit
    if (totalWithGap > containerWidth) return;

    const causeChain: CauseStep[] = [
      {
        element: container.selector,
        property: "flex-wrap",
        value: wrap,
        ruleSource: findRuleForProperty(container, "flex-wrap"),
        explanation: `flex-wrap: ${wrap} is set, and items have wrapped`,
      },
      {
        element: container.selector,
        property: "width",
        value: `${containerWidth}px`,
        explanation: `Container is ${containerWidth}px wide, items total ${totalWithGap}px (should fit without wrapping)`,
      },
    ];

    issues.push({
      category: this.category,
      severity: "warning",
      summary: `Items wrap unexpectedly: total items width (${Math.round(totalWithGap)}px) fits the container (${Math.round(containerWidth)}px)`,
      element: container,
      elementPath: getElementPath(container, tree),
      causeChain,
      rootCause: {
        description:
          "Items wrap despite their combined minimum width fitting the container. Check flex-basis, padding, or border-box sizing.",
        source: findRuleForProperty(container, "flex-wrap"),
      },
    });
  }

  /**
   * Detect grid items overflowing their assigned track.
   */
  private checkGridOverflow(
    container: LayoutNode,
    tree: LayoutTree,
    issues: Issue[],
  ): void {
    for (const child of container.children) {
      // Check if grid child overflows its cell
      if (
        child.scroll.scrollWidth <= child.scroll.clientWidth &&
        child.scroll.scrollHeight <= child.scroll.clientHeight
      ) {
        continue;
      }

      const childOverflowsHorizontally =
        child.scroll.scrollWidth > child.scroll.clientWidth;
      const childOverflowsVertically =
        child.scroll.scrollHeight > child.scroll.clientHeight;

      if (!childOverflowsHorizontally && !childOverflowsVertically) continue;

      const axis = childOverflowsHorizontally ? "horizontal" : "vertical";
      const causeChain: CauseStep[] = [];

      causeChain.push({
        element: container.selector,
        property: "display",
        value: container.computed.display,
        ruleSource: findRuleForProperty(container, "display"),
        explanation: "Parent is a grid container",
      });

      if (container.computed.gridTemplateColumns) {
        causeChain.push({
          element: container.selector,
          property: "grid-template-columns",
          value: container.computed.gridTemplateColumns,
          ruleSource: findRuleForProperty(container, "grid-template-columns"),
          explanation: `Grid track definition: ${container.computed.gridTemplateColumns}`,
        });
      }

      causeChain.push({
        element: child.selector,
        property: "overflow",
        value: `scrollWidth: ${child.scroll.scrollWidth}, clientWidth: ${child.scroll.clientWidth}`,
        explanation: `Grid item content overflows its track ${axis}ly`,
      });

      issues.push({
        category: this.category,
        severity: "warning",
        summary: `Grid item overflows its track (${axis})`,
        element: child,
        elementPath: getElementPath(child, tree),
        causeChain,
        rootCause: {
          description: `Grid item content exceeds the ${axis} track size. Consider using minmax(), overflow: hidden, or min-width: 0.`,
        },
        relatedNodes: [container],
      });
    }
  }
}
