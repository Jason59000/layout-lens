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
 * Detects stacking context issues: trapped z-index, accidental stacking contexts.
 *
 * Checks:
 * - Element with high z-index trapped in a parent stacking context
 * - Stacking contexts created unintentionally (transform, opacity, etc.)
 * - Reports the stacking context chain to root
 */
export class StackingDetector implements Detector {
  readonly category: IssueCategory = "stacking";

  detect(tree: LayoutTree): Issue[] {
    const issues: Issue[] = [];

    // Build a map of nodeId -> node for parent lookups
    const nodeMap = new Map<number, LayoutNode>();
    walkTree(tree, (node) => nodeMap.set(node.nodeId, node));

    walkTree(tree, (node) => {
      this.checkTrappedZIndex(node, nodeMap, tree, issues);
      this.checkAccidentalContext(node, nodeMap, tree, issues);
    });

    return issues;
  }

  /**
   * Detect elements with z-index that is ineffective because a parent
   * stacking context has a lower z-index than a sibling context.
   */
  private checkTrappedZIndex(
    node: LayoutNode,
    nodeMap: Map<number, LayoutNode>,
    tree: LayoutTree,
    issues: Issue[],
  ): void {
    const { stacking, computed } = node;

    // Only care about elements that set a z-index
    if (stacking.zIndex === "auto" || typeof stacking.zIndex !== "number")
      return;
    if (stacking.zIndex < 10) return; // Not "high" enough to be suspicious

    // Walk up to find the nearest stacking context parent
    const contextChain = this.getStackingContextChain(node, nodeMap);
    if (contextChain.length < 2) return; // No parent context to be trapped in

    const parentContext = contextChain[1]; // Nearest parent stacking context
    const parentZIndex = parentContext.stacking.zIndex;

    // If the parent stacking context has a z-index, the child's high z-index
    // only competes within that context
    if (typeof parentZIndex === "number") {
      const causeChain: CauseStep[] = [];

      causeChain.push({
        element: node.selector,
        property: "z-index",
        value: String(stacking.zIndex),
        ruleSource: findRuleForProperty(node, "z-index"),
        explanation: `Element has z-index: ${stacking.zIndex} but is inside a stacking context`,
      });

      causeChain.push({
        element: parentContext.selector,
        property: "z-index",
        value: String(parentZIndex),
        ruleSource: findRuleForProperty(parentContext, "z-index"),
        explanation: `Parent stacking context has z-index: ${parentZIndex}${parentContext.stacking.contextReason ? ` (created by ${parentContext.stacking.contextReason})` : ""}`,
      });

      const chainDescription = contextChain
        .map((n) => `${n.selector}(z:${n.stacking.zIndex})`)
        .join(" > ");

      issues.push({
        category: this.category,
        severity: "warning",
        summary: `z-index ${stacking.zIndex} is trapped inside parent stacking context (z-index: ${parentZIndex}). Chain: ${chainDescription}`,
        element: node,
        elementPath: getElementPath(node, tree),
        causeChain,
        rootCause: {
          description: `z-index ${stacking.zIndex} only competes within parent context ${parentContext.selector} (z-index: ${parentZIndex})`,
          source: findRuleForProperty(parentContext, "z-index"),
        },
        relatedNodes: [parentContext],
        impact: `This element's z-index of ${stacking.zIndex} will not place it above elements outside the parent stacking context`,
      });
    }
  }

  /**
   * Detect stacking contexts created by non-obvious properties
   * (transform, opacity, will-change, filter).
   */
  private checkAccidentalContext(
    node: LayoutNode,
    _nodeMap: Map<number, LayoutNode>,
    tree: LayoutTree,
    issues: Issue[],
  ): void {
    if (!node.stacking.createsContext) return;
    if (!node.stacking.contextReason) return;

    const reason = node.stacking.contextReason;

    // Only flag "accidental" context triggers
    const accidentalTriggers = [
      { pattern: /transform:/, property: "transform" },
      { pattern: /opacity:/, property: "opacity" },
      { pattern: /will-change:/, property: "will-change" },
      { pattern: /filter:/, property: "filter" },
    ];

    for (const trigger of accidentalTriggers) {
      if (!trigger.pattern.test(reason)) continue;

      const computed = node.computed;
      let isLikelyAccidental = false;
      let detail = "";

      if (
        trigger.property === "transform" &&
        (computed.transform === "translateX(0px)" ||
          computed.transform === "translateY(0px)" ||
          computed.transform === "translate(0px, 0px)" ||
          computed.transform === "translateZ(0px)" ||
          computed.transform === "translate3d(0px, 0px, 0px)")
      ) {
        isLikelyAccidental = true;
        detail = `transform: ${computed.transform} is a no-op but creates a stacking context`;
      }

      if (trigger.property === "opacity") {
        const opacity = parseFloat(computed.opacity);
        if (opacity > 0.97 && opacity < 1) {
          isLikelyAccidental = true;
          detail = `opacity: ${computed.opacity} is near-1 but creates a stacking context`;
        }
      }

      if (trigger.property === "will-change" && computed.willChange !== "auto") {
        isLikelyAccidental = true;
        detail = `will-change: ${computed.willChange} creates a stacking context`;
      }

      if (!isLikelyAccidental) continue;

      // Check if any child has a z-index that could be affected
      const hasZIndexChild = node.children.some(
        (child) =>
          child.stacking.zIndex !== "auto" &&
          typeof child.stacking.zIndex === "number",
      );

      if (!hasZIndexChild) continue;

      const causeChain: CauseStep[] = [];
      const rule = findRuleForProperty(node, trigger.property);

      causeChain.push({
        element: node.selector,
        property: trigger.property,
        value: (computed as unknown as Record<string, string>)[trigger.property] ?? "",
        ruleSource: rule,
        explanation: detail,
      });

      issues.push({
        category: this.category,
        severity: "warning",
        summary: `Likely accidental stacking context: ${detail}`,
        element: node,
        elementPath: getElementPath(node, tree),
        causeChain,
        rootCause: {
          description: detail,
          source: rule,
        },
        impact:
          "Children with z-index are confined to this context and cannot overlap elements outside it",
      });
    }
  }

  /**
   * Build the chain of stacking contexts from a node to the root.
   */
  private getStackingContextChain(
    node: LayoutNode,
    nodeMap: Map<number, LayoutNode>,
  ): LayoutNode[] {
    const chain: LayoutNode[] = [];
    let current: LayoutNode | undefined = node;

    while (current) {
      if (current.stacking.createsContext || current === node) {
        chain.push(current);
      }
      if (current.parentId !== undefined) {
        current = nodeMap.get(current.parentId);
      } else {
        break;
      }
    }

    return chain;
  }
}
