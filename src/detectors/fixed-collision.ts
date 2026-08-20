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
 * Detects content hidden behind fixed/sticky positioned elements.
 *
 * Checks:
 * - Fixed elements overlapping scrollable content
 * - Fixed header/footer hiding content (missing compensating padding)
 * - Sticky elements colliding with fixed elements
 */
export class FixedCollisionDetector implements Detector {
  readonly category: IssueCategory = "fixed-collision";

  detect(tree: LayoutTree): Issue[] {
    const issues: Issue[] = [];

    // Collect fixed and sticky elements
    const fixedElements: LayoutNode[] = [];
    const stickyElements: LayoutNode[] = [];

    walkTree(tree, (node) => {
      if (node.computed.position === "fixed") {
        fixedElements.push(node);
      }
      if (node.computed.position === "sticky") {
        stickyElements.push(node);
      }
    });

    if (fixedElements.length === 0) return issues;

    // Check fixed elements for content coverage
    for (const fixed of fixedElements) {
      this.checkFixedCoverage(fixed, tree, issues);
    }

    // Check sticky vs fixed collisions
    for (const sticky of stickyElements) {
      for (const fixed of fixedElements) {
        this.checkStickyFixedCollision(sticky, fixed, tree, issues);
      }
    }

    return issues;
  }

  /**
   * Check if a fixed-position element covers content without
   * proper compensating padding on the body/main content.
   */
  private checkFixedCoverage(
    fixed: LayoutNode,
    tree: LayoutTree,
    issues: Issue[],
  ): void {
    const { boxModel, computed } = fixed;
    const { viewport } = tree;

    // Determine if this is a top-fixed element (header pattern)
    const isTopFixed = boxModel.total.y < viewport.height * 0.15;
    const isBottomFixed =
      boxModel.total.y + boxModel.total.height >
      viewport.height * 0.85;
    const isFullWidth =
      boxModel.total.width > viewport.width * 0.5;

    if (!isFullWidth) return; // Narrow fixed elements are usually buttons/fab
    if (!isTopFixed && !isBottomFixed) return; // Only check header/footer patterns

    const fixedHeight = boxModel.total.height;
    if (fixedHeight < 10) return; // Too small to matter

    // Find body or main content element
    const bodyNode = this.findBodyOrMain(tree);
    if (!bodyNode) return;

    if (isTopFixed) {
      // Check if body has padding-top or margin-top >= fixed height
      const bodyPaddingTop = bodyNode.boxModel.padding.top;
      const bodyMarginTop = bodyNode.boxModel.margin.top;
      const compensation = bodyPaddingTop + bodyMarginTop;

      // Allow some tolerance
      if (compensation >= fixedHeight - 5) return;

      const causeChain: CauseStep[] = [];

      causeChain.push({
        element: fixed.selector,
        property: "position",
        value: "fixed",
        ruleSource: findRuleForProperty(fixed, "position"),
        explanation: `Element is fixed at the top of the viewport (height: ${Math.round(fixedHeight)}px)`,
      });

      causeChain.push({
        element: fixed.selector,
        property: "height",
        value: `${Math.round(fixedHeight)}px`,
        ruleSource: findRuleForProperty(fixed, "height"),
        explanation: `Fixed element occupies ${Math.round(fixedHeight)}px at the top`,
      });

      causeChain.push({
        element: bodyNode.selector,
        property: "padding-top",
        value: `${bodyPaddingTop}px`,
        ruleSource: findRuleForProperty(bodyNode, "padding-top") ?? findRuleForProperty(bodyNode, "padding"),
        explanation: `Content area has only ${bodyPaddingTop}px of top padding (needs ~${Math.round(fixedHeight)}px to avoid being hidden)`,
      });

      issues.push({
        category: this.category,
        severity: "error",
        summary: `Fixed header (${Math.round(fixedHeight)}px) likely covers content: body padding-top is only ${bodyPaddingTop}px`,
        element: fixed,
        elementPath: getElementPath(fixed, tree),
        causeChain,
        rootCause: {
          description: `The fixed header is ${Math.round(fixedHeight)}px tall but the content below has only ${bodyPaddingTop}px of padding-top. Add padding-top: ${Math.round(fixedHeight)}px to the content container.`,
          source: findRuleForProperty(bodyNode, "padding-top"),
        },
        relatedNodes: [bodyNode],
        impact: `The first ~${Math.round(fixedHeight - compensation)}px of content is hidden behind the fixed header`,
      });
    }

    if (isBottomFixed) {
      const bodyPaddingBottom = bodyNode.boxModel.padding.bottom;
      const bodyMarginBottom = bodyNode.boxModel.margin.bottom;
      const compensation = bodyPaddingBottom + bodyMarginBottom;

      if (compensation >= fixedHeight - 5) return;

      const causeChain: CauseStep[] = [];

      causeChain.push({
        element: fixed.selector,
        property: "position",
        value: "fixed",
        ruleSource: findRuleForProperty(fixed, "position"),
        explanation: `Element is fixed at the bottom of the viewport (height: ${Math.round(fixedHeight)}px)`,
      });

      causeChain.push({
        element: bodyNode.selector,
        property: "padding-bottom",
        value: `${bodyPaddingBottom}px`,
        ruleSource: findRuleForProperty(bodyNode, "padding-bottom") ?? findRuleForProperty(bodyNode, "padding"),
        explanation: `Content area has only ${bodyPaddingBottom}px of bottom padding (needs ~${Math.round(fixedHeight)}px)`,
      });

      issues.push({
        category: this.category,
        severity: "error",
        summary: `Fixed footer (${Math.round(fixedHeight)}px) likely covers content: body padding-bottom is only ${bodyPaddingBottom}px`,
        element: fixed,
        elementPath: getElementPath(fixed, tree),
        causeChain,
        rootCause: {
          description: `The fixed footer is ${Math.round(fixedHeight)}px tall but the content has only ${bodyPaddingBottom}px of padding-bottom.`,
          source: findRuleForProperty(bodyNode, "padding-bottom"),
        },
        relatedNodes: [bodyNode],
        impact: `The last ~${Math.round(fixedHeight - compensation)}px of content may be hidden behind the fixed footer`,
      });
    }
  }

  /**
   * Check if a sticky element collides with a fixed element when scrolled to its stuck position.
   */
  private checkStickyFixedCollision(
    sticky: LayoutNode,
    fixed: LayoutNode,
    tree: LayoutTree,
    issues: Issue[],
  ): void {
    // Check if the sticky element's stuck position would overlap the fixed element
    const stickyTop = sticky.computed.positionSticky?.top;
    if (stickyTop === undefined) return;

    const stickyTopPx = parseFloat(stickyTop);
    if (isNaN(stickyTopPx)) return;

    const fixedBottom =
      fixed.boxModel.total.y + fixed.boxModel.total.height;

    // When sticky is "stuck", it would be at top: stickyTopPx from viewport
    // If a fixed element extends below that point, they collide
    if (stickyTopPx >= fixedBottom) return;

    // Check if they actually share horizontal space
    const stickyLeft = sticky.boxModel.total.x;
    const stickyRight = stickyLeft + sticky.boxModel.total.width;
    const fixedLeft = fixed.boxModel.total.x;
    const fixedRight = fixedLeft + fixed.boxModel.total.width;

    const horizontalOverlap =
      stickyLeft < fixedRight && stickyRight > fixedLeft;
    if (!horizontalOverlap) return;

    const overlapPx = Math.round(fixedBottom - stickyTopPx);

    const causeChain: CauseStep[] = [];

    causeChain.push({
      element: sticky.selector,
      property: "position",
      value: "sticky",
      ruleSource: findRuleForProperty(sticky, "position"),
      explanation: `Element uses position: sticky with top: ${stickyTop}`,
    });

    causeChain.push({
      element: sticky.selector,
      property: "top",
      value: stickyTop,
      ruleSource: findRuleForProperty(sticky, "top"),
      explanation: `Sticky element sticks at ${stickyTopPx}px from viewport top`,
    });

    causeChain.push({
      element: fixed.selector,
      property: "position",
      value: "fixed",
      ruleSource: findRuleForProperty(fixed, "position"),
      explanation: `Fixed element extends to ${Math.round(fixedBottom)}px from viewport top`,
    });

    issues.push({
      category: this.category,
      severity: "warning",
      summary: `Sticky element (top: ${stickyTop}) collides with fixed element by ${overlapPx}px`,
      element: sticky,
      elementPath: getElementPath(sticky, tree),
      causeChain,
      rootCause: {
        description: `When the sticky element reaches its stuck position (top: ${stickyTop}), it overlaps with the fixed element by ${overlapPx}px. Adjust the sticky top value to ${Math.round(fixedBottom)}px.`,
        source: findRuleForProperty(sticky, "top"),
      },
      relatedNodes: [fixed],
      impact: `The sticky element will be partially hidden behind the fixed element when scrolled`,
    });
  }

  /**
   * Find the body element or a main content container in the tree.
   */
  private findBodyOrMain(tree: LayoutTree): LayoutNode | null {
    let body: LayoutNode | null = null;
    let main: LayoutNode | null = null;

    walkTree(tree, (node) => {
      if (node.tag === "body") body = node;
      if (node.tag === "main" && !main) main = node;
    });

    // Prefer main if it exists, otherwise body
    return main ?? body;
  }
}
