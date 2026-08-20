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
 * Detects elements that are invisible or effectively invisible.
 *
 * Checks:
 * - visibility: hidden
 * - opacity: 0
 * - clip-path that hides everything
 * - Element positioned off-viewport (large negative top/left)
 * - Zero-size elements (width: 0 or height: 0)
 * - Sub-pixel elements (< 1px)
 */
export class VisibilityDetector implements Detector {
  readonly category: IssueCategory = "visibility";

  detect(tree: LayoutTree): Issue[] {
    const issues: Issue[] = [];

    walkTree(tree, (node) => {
      // Skip trivially non-visual elements
      if (node.tag === "br" || node.tag === "hr" || node.tag === "head") return;

      this.checkVisibilityHidden(node, tree, issues);
      this.checkOpacityZero(node, tree, issues);
      this.checkClipPath(node, tree, issues);
      this.checkOffViewport(node, tree, issues);
      this.checkZeroSize(node, tree, issues);
    });

    return issues;
  }

  private checkVisibilityHidden(
    node: LayoutNode,
    tree: LayoutTree,
    issues: Issue[],
  ): void {
    if (node.computed.visibility !== "hidden") return;

    const rule = findRuleForProperty(node, "visibility");
    const causeChain: CauseStep[] = [
      {
        element: node.selector,
        property: "visibility",
        value: "hidden",
        ruleSource: rule,
        explanation:
          "Element is invisible via visibility: hidden (still occupies layout space)",
      },
    ];

    issues.push({
      category: this.category,
      severity: "info",
      summary: "Element is hidden via visibility: hidden (occupies space but invisible)",
      element: node,
      elementPath: getElementPath(node, tree),
      causeChain,
      rootCause: {
        description: "visibility: hidden makes the element invisible while keeping its layout box",
        source: rule,
      },
    });
  }

  private checkOpacityZero(
    node: LayoutNode,
    tree: LayoutTree,
    issues: Issue[],
  ): void {
    const opacity = parseFloat(node.computed.opacity);
    if (isNaN(opacity) || opacity > 0) return;

    const rule = findRuleForProperty(node, "opacity");
    const causeChain: CauseStep[] = [
      {
        element: node.selector,
        property: "opacity",
        value: node.computed.opacity,
        ruleSource: rule,
        explanation:
          "Element is fully transparent via opacity: 0 (still occupies layout space and receives events)",
      },
    ];

    issues.push({
      category: this.category,
      severity: "info",
      summary: "Element is fully transparent (opacity: 0)",
      element: node,
      elementPath: getElementPath(node, tree),
      causeChain,
      rootCause: {
        description: "opacity: 0 makes the element fully transparent but it still occupies space and can receive pointer events",
        source: rule,
      },
    });
  }

  private checkClipPath(
    node: LayoutNode,
    tree: LayoutTree,
    issues: Issue[],
  ): void {
    const clipPath = node.computed.clipPath;
    if (!clipPath || clipPath === "none") return;

    // Detect clip-path that hides everything
    const hidingPatterns = [
      "inset(50%)",
      "inset(100%)",
      "circle(0",
      "polygon(0 0, 0 0, 0 0",
      "polygon(0px 0px, 0px 0px, 0px 0px",
    ];

    const isHiding = hidingPatterns.some((p) =>
      clipPath.toLowerCase().includes(p.toLowerCase()),
    );
    if (!isHiding) return;

    const rule = findRuleForProperty(node, "clip-path");
    const causeChain: CauseStep[] = [
      {
        element: node.selector,
        property: "clip-path",
        value: clipPath,
        ruleSource: rule,
        explanation: `clip-path: ${clipPath} clips the element to nothing, making it invisible`,
      },
    ];

    issues.push({
      category: this.category,
      severity: "warning",
      summary: `Element is hidden by clip-path: ${clipPath}`,
      element: node,
      elementPath: getElementPath(node, tree),
      causeChain,
      rootCause: {
        description: "clip-path clips the element to a zero-area region",
        source: rule,
      },
    });
  }

  private checkOffViewport(
    node: LayoutNode,
    tree: LayoutTree,
    issues: Issue[],
  ): void {
    const { computed, boxModel } = node;
    const pos = computed.position;
    if (pos !== "absolute" && pos !== "fixed") return;

    const { viewport } = tree;
    const { total } = boxModel;

    // Check if element is completely off-screen
    const isOffLeft = total.x + total.width < 0;
    const isOffTop = total.y + total.height < 0;
    const isOffRight = total.x > viewport.width;
    const isOffBottom = total.y > viewport.height;
    const isFarOff =
      total.x < -9999 || total.y < -9999 || total.x > 9999 || total.y > 9999;

    if (!isOffLeft && !isOffTop && !isOffRight && !isOffBottom && !isFarOff)
      return;

    // This is a common accessibility technique, report at info level
    const severity: IssueSeverity = isFarOff ? "info" : "warning";
    const causeChain: CauseStep[] = [];

    const posRule = findRuleForProperty(node, "position");
    causeChain.push({
      element: node.selector,
      property: "position",
      value: pos,
      ruleSource: posRule,
      explanation: `Element is positioned ${pos}`,
    });

    // Identify which offset pushes it off-screen
    for (const prop of ["top", "left", "right", "bottom"] as const) {
      const rule = findRuleForProperty(node, prop);
      if (rule && rule.value !== "auto") {
        causeChain.push({
          element: node.selector,
          property: prop,
          value: rule.value,
          ruleSource: rule,
          explanation: `${prop}: ${rule.value} positions element off-viewport`,
        });
      }
    }

    const direction = isOffLeft
      ? "left"
      : isOffTop
        ? "top"
        : isOffRight
          ? "right"
          : "bottom";

    issues.push({
      category: this.category,
      severity,
      summary: `Element positioned off-viewport (${direction}) at (${Math.round(total.x)}, ${Math.round(total.y)})`,
      element: node,
      elementPath: getElementPath(node, tree),
      causeChain,
      rootCause: {
        description: `Element with position: ${pos} is placed completely outside the visible viewport`,
        source: posRule,
      },
    });
  }

  private checkZeroSize(
    node: LayoutNode,
    tree: LayoutTree,
    issues: Issue[],
  ): void {
    const { content } = node.boxModel;

    // Skip elements that naturally have no content area (inline, etc.)
    if (node.children.length === 0 && node.tag !== "img" && node.tag !== "video" && node.tag !== "canvas") {
      // Only flag if it has padding/border (indicating it should have content)
      const hasPadding =
        node.boxModel.padding.top > 0 ||
        node.boxModel.padding.right > 0 ||
        node.boxModel.padding.bottom > 0 ||
        node.boxModel.padding.left > 0;
      const hasBorder =
        node.boxModel.border.top > 0 ||
        node.boxModel.border.right > 0 ||
        node.boxModel.border.bottom > 0 ||
        node.boxModel.border.left > 0;

      if (!hasPadding && !hasBorder) return;
    }

    const isZeroWidth = content.width === 0;
    const isZeroHeight = content.height === 0;
    const isSubPixelWidth = content.width > 0 && content.width < 1;
    const isSubPixelHeight = content.height > 0 && content.height < 1;

    if (!isZeroWidth && !isZeroHeight && !isSubPixelWidth && !isSubPixelHeight)
      return;

    const causeChain: CauseStep[] = [];

    if (isZeroWidth || isSubPixelWidth) {
      const rule = findRuleForProperty(node, "width");
      causeChain.push({
        element: node.selector,
        property: "width",
        value: `${content.width}px`,
        ruleSource: rule,
        explanation: isZeroWidth
          ? "Element has zero width"
          : `Element has sub-pixel width (${content.width}px), may be invisible`,
      });
    }

    if (isZeroHeight || isSubPixelHeight) {
      const rule = findRuleForProperty(node, "height");
      causeChain.push({
        element: node.selector,
        property: "height",
        value: `${content.height}px`,
        ruleSource: rule,
        explanation: isZeroHeight
          ? "Element has zero height"
          : `Element has sub-pixel height (${content.height}px), may be invisible`,
      });
    }

    const isZero = isZeroWidth || isZeroHeight;

    issues.push({
      category: this.category,
      severity: isZero ? "warning" : "info",
      summary: isZero
        ? `Element has zero size (${content.width}x${content.height}px)`
        : `Element is too small to be visible (${content.width.toFixed(2)}x${content.height.toFixed(2)}px)`,
      element: node,
      elementPath: getElementPath(node, tree),
      causeChain,
      rootCause: {
        description: isZero
          ? "Element has zero dimension, making it invisible"
          : "Element is smaller than 1px in at least one dimension",
      },
    });
  }
}
