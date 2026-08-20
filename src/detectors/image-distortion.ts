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
 * Detects image distortion issues.
 *
 * Checks:
 * - Aspect ratio mismatch between natural size and displayed size
 * - Missing object-fit when dimensions are forced
 * - Explicit width AND height that don't preserve the aspect ratio
 */
export class ImageDistortionDetector implements Detector {
  readonly category: IssueCategory = "image-distortion";

  detect(tree: LayoutTree): Issue[] {
    const issues: Issue[] = [];

    walkTree(tree, (node) => {
      if (node.tag !== "img") return;
      if (!node.naturalSize) return;
      if (node.naturalSize.width === 0 || node.naturalSize.height === 0) return;

      this.checkAspectRatio(node, tree, issues);
    });

    return issues;
  }

  private checkAspectRatio(
    node: LayoutNode,
    tree: LayoutTree,
    issues: Issue[],
  ): void {
    const natural = node.naturalSize!;
    const displayed = node.boxModel.content;

    // Skip zero-size displayed images (handled by visibility detector)
    if (displayed.width === 0 || displayed.height === 0) return;

    const naturalRatio = natural.width / natural.height;
    const displayedRatio = displayed.width / displayed.height;

    // Allow some tolerance for rounding (2% deviation)
    const ratioDiff = Math.abs(naturalRatio - displayedRatio) / naturalRatio;
    if (ratioDiff < 0.02) return;

    // Check if object-fit is set (which handles distortion intentionally)
    const objectFit = node.computed.objectFit;
    if (objectFit && objectFit !== "fill") {
      // object-fit: cover, contain, etc. handle the aspect ratio
      return;
    }

    const causeChain: CauseStep[] = [];

    causeChain.push({
      element: node.selector,
      property: "natural-size",
      value: `${natural.width}x${natural.height} (ratio: ${naturalRatio.toFixed(3)})`,
      explanation: `Image natural size is ${natural.width}x${natural.height} (aspect ratio: ${naturalRatio.toFixed(3)})`,
    });

    causeChain.push({
      element: node.selector,
      property: "displayed-size",
      value: `${Math.round(displayed.width)}x${Math.round(displayed.height)} (ratio: ${displayedRatio.toFixed(3)})`,
      explanation: `Image is displayed at ${Math.round(displayed.width)}x${Math.round(displayed.height)} (aspect ratio: ${displayedRatio.toFixed(3)})`,
    });

    // Identify which dimension is forced
    const widthRule = findRuleForProperty(node, "width");
    const heightRule = findRuleForProperty(node, "height");

    if (widthRule && !widthRule.isUserAgent) {
      causeChain.push({
        element: node.selector,
        property: "width",
        value: widthRule.value,
        ruleSource: widthRule,
        explanation: `Explicit width: ${widthRule.value} is set`,
      });
    }

    if (heightRule && !heightRule.isUserAgent) {
      causeChain.push({
        element: node.selector,
        property: "height",
        value: heightRule.value,
        ruleSource: heightRule,
        explanation: `Explicit height: ${heightRule.value} is set`,
      });
    }

    // Flag missing object-fit
    if (!objectFit || objectFit === "fill") {
      const fitRule = findRuleForProperty(node, "object-fit");
      causeChain.push({
        element: node.selector,
        property: "object-fit",
        value: objectFit ?? "fill (default)",
        ruleSource: fitRule,
        explanation:
          "No object-fit is set (or defaults to fill), so the image stretches to fill the given dimensions, distorting it",
      });
    }

    const distortionPct = Math.round(ratioDiff * 100);
    const isStretched = displayedRatio > naturalRatio;
    const direction = isStretched ? "horizontally" : "vertically";

    issues.push({
      category: this.category,
      severity: distortionPct > 10 ? "error" : "warning",
      summary: `Image distorted ${direction} by ~${distortionPct}% (natural: ${natural.width}x${natural.height}, displayed: ${Math.round(displayed.width)}x${Math.round(displayed.height)})`,
      element: node,
      elementPath: getElementPath(node, tree),
      causeChain,
      rootCause: {
        description: `Image aspect ratio is distorted because both width and height are constrained without object-fit. Add object-fit: cover or object-fit: contain to preserve the ratio.`,
        source: widthRule ?? heightRule,
      },
      impact: `The image appears ${direction} stretched by approximately ${distortionPct}%`,
    });
  }
}
