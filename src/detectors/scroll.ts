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
 * Detects scroll-related issues: broken sticky, nested scrollbars, useless scroll containers.
 *
 * Checks:
 * - position: sticky broken by parent overflow: hidden/auto
 * - Nested scroll containers (scroll inside scroll)
 * - Double scrollbar on same axis
 * - Useless scroll container (overflow: auto but no actual overflow)
 */
export class ScrollDetector implements Detector {
  readonly category: IssueCategory = "scroll";

  detect(tree: LayoutTree): Issue[] {
    const issues: Issue[] = [];
    const nodeMap = new Map<number, LayoutNode>();
    walkTree(tree, (node) => nodeMap.set(node.nodeId, node));

    walkTree(tree, (node) => {
      this.checkBrokenSticky(node, nodeMap, tree, issues);
      this.checkNestedScroll(node, nodeMap, tree, issues);
      this.checkUselessScrollContainer(node, tree, issues);
    });

    return issues;
  }

  /**
   * Detect position: sticky that doesn't work because a parent
   * has overflow: hidden or overflow: auto (which confines the sticky behavior).
   */
  private checkBrokenSticky(
    node: LayoutNode,
    nodeMap: Map<number, LayoutNode>,
    tree: LayoutTree,
    issues: Issue[],
  ): void {
    if (node.computed.position !== "sticky") return;

    // Walk up the tree to find a parent with overflow that breaks sticky
    let current: LayoutNode | undefined =
      node.parentId !== undefined ? nodeMap.get(node.parentId) : undefined;

    while (current) {
      const { overflowX, overflowY } = current.computed;
      const breaksSticky =
        overflowX === "hidden" ||
        overflowX === "auto" ||
        overflowX === "scroll" ||
        overflowY === "hidden" ||
        overflowY === "auto" ||
        overflowY === "scroll";

      if (breaksSticky) {
        // Check if this parent is actually the scroll container for the sticky
        // (sticky only breaks if the overflow parent is between the sticky and its scroll container)
        const isActualScrollContainer =
          current.scroll.isScrollContainer;

        // If the parent has overflow:hidden and is NOT a scroll container,
        // sticky will be broken
        const overflowValue =
          overflowY === "hidden"
            ? "hidden"
            : overflowX === "hidden"
              ? "hidden"
              : overflowY || overflowX;

        if (overflowValue === "hidden" || !isActualScrollContainer) {
          const causeChain: CauseStep[] = [];

          causeChain.push({
            element: node.selector,
            property: "position",
            value: "sticky",
            ruleSource: findRuleForProperty(node, "position"),
            explanation: "Element uses position: sticky",
          });

          const axis =
            overflowY === "hidden" || overflowY === "auto" || overflowY === "scroll"
              ? "overflow-y"
              : "overflow-x";

          causeChain.push({
            element: current.selector,
            property: axis,
            value: current.computed[axis === "overflow-y" ? "overflowY" : "overflowX"],
            ruleSource: findRuleForProperty(current, axis),
            explanation: `Parent has ${axis}: ${current.computed[axis === "overflow-y" ? "overflowY" : "overflowX"]} which prevents sticky from working`,
          });

          issues.push({
            category: this.category,
            severity: "error",
            summary: `position: sticky is broken by parent ${current.selector} with ${axis}: ${current.computed[axis === "overflow-y" ? "overflowY" : "overflowX"]}`,
            element: node,
            elementPath: getElementPath(node, tree),
            causeChain,
            rootCause: {
              description: `A parent element (${current.selector}) has ${axis}: ${current.computed[axis === "overflow-y" ? "overflowY" : "overflowX"]} which creates a scroll container that traps the sticky positioning`,
              source: findRuleForProperty(current, axis),
            },
            relatedNodes: [current],
            impact:
              "The sticky element will scroll with its content instead of sticking to the viewport",
          });
          return; // Only report the first breaking parent
        }
      }

      if (current.parentId !== undefined) {
        current = nodeMap.get(current.parentId);
      } else {
        break;
      }
    }
  }

  /**
   * Detect nested scroll containers (scroll inside scroll on the same axis).
   */
  private checkNestedScroll(
    node: LayoutNode,
    nodeMap: Map<number, LayoutNode>,
    tree: LayoutTree,
    issues: Issue[],
  ): void {
    if (!node.scroll.isScrollContainer) return;

    const isHorizontalScroll =
      node.scroll.scrollWidth > node.scroll.clientWidth;
    const isVerticalScroll =
      node.scroll.scrollHeight > node.scroll.clientHeight;

    // Walk up to find parent scroll containers on the same axis
    let current: LayoutNode | undefined =
      node.parentId !== undefined ? nodeMap.get(node.parentId) : undefined;

    while (current) {
      if (current.scroll.isScrollContainer) {
        const parentHorizScroll =
          current.scroll.scrollWidth > current.scroll.clientWidth;
        const parentVertScroll =
          current.scroll.scrollHeight > current.scroll.clientHeight;

        const sameAxisHoriz = isHorizontalScroll && parentHorizScroll;
        const sameAxisVert = isVerticalScroll && parentVertScroll;

        if (sameAxisHoriz || sameAxisVert) {
          const axis = sameAxisHoriz ? "horizontal" : "vertical";
          const causeChain: CauseStep[] = [];

          causeChain.push({
            element: node.selector,
            property: axis === "horizontal" ? "overflow-x" : "overflow-y",
            value:
              axis === "horizontal"
                ? node.computed.overflowX
                : node.computed.overflowY,
            explanation: `This element is a ${axis} scroll container`,
          });

          causeChain.push({
            element: current.selector,
            property: axis === "horizontal" ? "overflow-x" : "overflow-y",
            value:
              axis === "horizontal"
                ? current.computed.overflowX
                : current.computed.overflowY,
            explanation: `Parent is also a ${axis} scroll container, creating double scrollbar`,
          });

          issues.push({
            category: this.category,
            severity: "warning",
            summary: `Double ${axis} scrollbar: nested scroll containers`,
            element: node,
            elementPath: getElementPath(node, tree),
            causeChain,
            rootCause: {
              description: `Both ${node.selector} and ancestor ${current.selector} scroll on the same ${axis} axis, creating a confusing double-scrollbar experience`,
            },
            relatedNodes: [current],
            impact: `Users may have difficulty scrolling as both containers respond to ${axis} scroll events`,
          });
          return; // Report only the nearest ancestor
        }
      }

      if (current.parentId !== undefined) {
        current = nodeMap.get(current.parentId);
      } else {
        break;
      }
    }
  }

  /**
   * Detect scroll containers where overflow: auto/scroll is declared
   * but there is no actual overflow (useless scrollbar declaration).
   */
  private checkUselessScrollContainer(
    node: LayoutNode,
    tree: LayoutTree,
    issues: Issue[],
  ): void {
    const { computed, scroll } = node;

    const declaresHorizScroll =
      computed.overflowX === "auto" || computed.overflowX === "scroll";
    const declaresVertScroll =
      computed.overflowY === "auto" || computed.overflowY === "scroll";

    if (!declaresHorizScroll && !declaresVertScroll) return;

    const hasHorizOverflow = scroll.scrollWidth > scroll.clientWidth;
    const hasVertOverflow = scroll.scrollHeight > scroll.clientHeight;

    // Only flag if overflow is declared but content doesn't overflow
    if (declaresHorizScroll && !hasHorizOverflow && computed.overflowX === "scroll") {
      const causeChain: CauseStep[] = [
        {
          element: node.selector,
          property: "overflow-x",
          value: computed.overflowX,
          ruleSource: findRuleForProperty(node, "overflow-x") ?? findRuleForProperty(node, "overflow"),
          explanation: `overflow-x: scroll forces a scrollbar but content (${scroll.scrollWidth}px) fits within the container (${scroll.clientWidth}px)`,
        },
      ];

      issues.push({
        category: this.category,
        severity: "info",
        summary: `Unnecessary horizontal scrollbar: content fits (${scroll.scrollWidth}px in ${scroll.clientWidth}px)`,
        element: node,
        elementPath: getElementPath(node, tree),
        causeChain,
        rootCause: {
          description:
            "overflow-x: scroll forces a scrollbar even when content fits. Consider overflow-x: auto instead.",
          source: findRuleForProperty(node, "overflow-x") ?? findRuleForProperty(node, "overflow"),
        },
      });
    }

    if (declaresVertScroll && !hasVertOverflow && computed.overflowY === "scroll") {
      const causeChain: CauseStep[] = [
        {
          element: node.selector,
          property: "overflow-y",
          value: computed.overflowY,
          ruleSource: findRuleForProperty(node, "overflow-y") ?? findRuleForProperty(node, "overflow"),
          explanation: `overflow-y: scroll forces a scrollbar but content (${scroll.scrollHeight}px) fits within the container (${scroll.clientHeight}px)`,
        },
      ];

      issues.push({
        category: this.category,
        severity: "info",
        summary: `Unnecessary vertical scrollbar: content fits (${scroll.scrollHeight}px in ${scroll.clientHeight}px)`,
        element: node,
        elementPath: getElementPath(node, tree),
        causeChain,
        rootCause: {
          description:
            "overflow-y: scroll forces a scrollbar even when content fits. Consider overflow-y: auto instead.",
          source: findRuleForProperty(node, "overflow-y") ?? findRuleForProperty(node, "overflow"),
        },
      });
    }
  }
}
