import type { CauseStep, LayoutNode, LayoutTree } from "../types.js";
import { RuleTracer } from "./rule-tracer.js";

/**
 * Properties commonly responsible for horizontal overflow.
 */
const OVERFLOW_WIDTH_PROPERTIES = [
  "min-width",
  "width",
  "max-width",
  "flex-shrink",
  "flex-grow",
  "white-space",
  "padding-left",
  "padding-right",
  "margin-left",
  "margin-right",
  "border-left-width",
  "border-right-width",
] as const;

/**
 * Properties commonly responsible for vertical overflow.
 */
const OVERFLOW_HEIGHT_PROPERTIES = [
  "min-height",
  "height",
  "max-height",
  "flex-shrink",
  "flex-grow",
  "padding-top",
  "padding-bottom",
  "margin-top",
  "margin-bottom",
  "border-top-width",
  "border-bottom-width",
] as const;

/**
 * Properties that create stacking contexts.
 */
const STACKING_CONTEXT_PROPERTIES = [
  "z-index",
  "position",
  "opacity",
  "transform",
  "filter",
  "will-change",
  "isolation",
] as const;

/**
 * Properties that affect visibility.
 */
const VISIBILITY_PROPERTIES = [
  "display",
  "visibility",
  "opacity",
  "clip-path",
  "overflow",
  "overflow-x",
  "overflow-y",
  "height",
  "max-height",
  "width",
  "max-width",
] as const;

// ----- Tree navigation helpers -----

/**
 * Build an index of nodeId -> LayoutNode for fast lookups.
 */
function buildNodeIndex(tree: LayoutTree): Map<number, LayoutNode> {
  const index = new Map<number, LayoutNode>();

  function walk(node: LayoutNode): void {
    index.set(node.nodeId, node);
    for (const child of node.children) {
      walk(child);
    }
  }

  walk(tree.root);
  return index;
}

/**
 * Find the parent of a node by its parentId.
 */
function findParent(
  node: LayoutNode,
  index: Map<number, LayoutNode>,
): LayoutNode | undefined {
  if (node.parentId === undefined) return undefined;
  return index.get(node.parentId);
}

/**
 * Walk from a node up to the root, collecting each ancestor.
 */
function getAncestors(
  node: LayoutNode,
  index: Map<number, LayoutNode>,
): LayoutNode[] {
  const ancestors: LayoutNode[] = [];
  let current = findParent(node, index);
  while (current) {
    ancestors.push(current);
    current = findParent(current, index);
  }
  return ancestors;
}

/**
 * Build a readable element descriptor from a LayoutNode,
 * e.g. "div.container" or "table#data-table".
 */
function describeElement(node: LayoutNode): string {
  let desc = node.tag;
  if (node.id) {
    desc += `#${node.id}`;
  } else if (node.classes.length > 0) {
    desc += `.${node.classes.join(".")}`;
  }
  return desc;
}

/**
 * Map a computed style property name (camelCase) to its CSS property name.
 */
function toCSSProperty(computedKey: string): string {
  // Handle specific mappings
  const mappings: Record<string, string> = {
    overflowX: "overflow-x",
    overflowY: "overflow-y",
    boxSizing: "box-sizing",
    zIndex: "z-index",
    clipPath: "clip-path",
    willChange: "will-change",
    flexDirection: "flex-direction",
    flexWrap: "flex-wrap",
    flexShrink: "flex-shrink",
    flexGrow: "flex-grow",
    alignItems: "align-items",
    justifyContent: "justify-content",
    gridTemplateColumns: "grid-template-columns",
    gridTemplateRows: "grid-template-rows",
    gridGap: "grid-gap",
    minWidth: "min-width",
    maxWidth: "max-width",
    minHeight: "min-height",
    maxHeight: "max-height",
    whiteSpace: "white-space",
    textOverflow: "text-overflow",
    objectFit: "object-fit",
  };

  return mappings[computedKey] ?? computedKey;
}

/**
 * Get a computed style value from a node using the CSS property name.
 */
function getComputedValue(node: LayoutNode, cssProperty: string): string {
  const key = cssProperty.replace(/-([a-z])/g, (_, c: string) =>
    c.toUpperCase(),
  );
  const computed = node.computed as unknown as Record<string, string | undefined>;
  return computed[key] ?? "";
}

/**
 * CauseChainBuilder constructs diagnostic cause chains by walking
 * the LayoutTree from a problematic element up to the root.
 * Each step identifies what CSS property contributes to the issue
 * and which rule sets it.
 */
export class CauseChainBuilder {
  constructor(private ruleTracer: RuleTracer) {}

  /**
   * Build a cause chain explaining why overflow occurs on a node.
   *
   * Strategy:
   * 1. Identify which property on the element forces it to be too wide/tall
   * 2. Walk up to the parent: what constrains the parent's width?
   * 3. Check the parent's overflow setting (hidden/auto/visible)
   * 4. Continue up until we find the constraint origin
   */
  buildOverflowChain(node: LayoutNode, tree: LayoutTree): CauseStep[] {
    const steps: CauseStep[] = [];
    const index = buildNodeIndex(tree);

    // Step 1: Identify what makes this element overflow
    const elementWidth = node.boxModel.total.width;
    const parent = findParent(node, index);

    // Check horizontal overflow properties on the element
    for (const prop of OVERFLOW_WIDTH_PROPERTIES) {
      const value = getComputedValue(node, prop);
      if (!value || value === "auto" || value === "normal" || value === "0px") {
        continue;
      }

      // Check if this property contributes to overflow
      if (this.isOverflowContributor(prop, value, node)) {
        const ruleSource = this.ruleTracer.traceProperty(node, prop);
        steps.push({
          element: describeElement(node),
          property: prop,
          value,
          ruleSource,
          explanation: this.explainOverflowProperty(prop, value, node),
        });
      }
    }

    // Step 2: Check vertical overflow properties too
    for (const prop of OVERFLOW_HEIGHT_PROPERTIES) {
      const value = getComputedValue(node, prop);
      if (!value || value === "auto" || value === "normal" || value === "0px") {
        continue;
      }

      if (this.isOverflowContributor(prop, value, node)) {
        const ruleSource = this.ruleTracer.traceProperty(node, prop);
        steps.push({
          element: describeElement(node),
          property: prop,
          value,
          ruleSource,
          explanation: this.explainOverflowProperty(prop, value, node),
        });
      }
    }

    // Step 3: Walk up the tree to find constraining ancestors
    if (parent) {
      this.traceParentConstraints(parent, elementWidth, steps, index);
    }

    return steps;
  }

  /**
   * Build a cause chain explaining a stacking context issue.
   *
   * Strategy:
   * 1. Walk up from the node, collecting each stacking context
   * 2. For each context, record why it was created
   * 3. Identify where z-index is "trapped" within a context
   */
  buildStackingChain(node: LayoutNode, tree: LayoutTree): CauseStep[] {
    const steps: CauseStep[] = [];
    const index = buildNodeIndex(tree);

    // Record the element's own z-index and stacking info
    if (node.stacking.zIndex !== "auto") {
      const ruleSource = this.ruleTracer.traceProperty(node, "z-index");
      steps.push({
        element: describeElement(node),
        property: "z-index",
        value: String(node.stacking.zIndex),
        ruleSource,
        explanation: `Element has z-index: ${node.stacking.zIndex}${
          node.stacking.createsContext
            ? ", which creates a new stacking context"
            : ""
        }`,
      });
    }

    // Walk up and find all stacking contexts
    const ancestors = getAncestors(node, index);

    for (const ancestor of ancestors) {
      if (!ancestor.stacking.createsContext) continue;

      // Find which property creates the stacking context
      const reason = ancestor.stacking.contextReason ?? "unknown";
      const contextProperty = this.extractPrimaryStackingProperty(reason);

      const ruleSource = contextProperty
        ? this.ruleTracer.traceProperty(ancestor, contextProperty)
        : undefined;

      steps.push({
        element: describeElement(ancestor),
        property: contextProperty ?? "stacking-context",
        value: reason,
        ruleSource,
        explanation: `Creates a stacking context because of ${reason}. ` +
          `Any z-index on descendants is trapped within this context.`,
      });
    }

    return steps;
  }

  /**
   * Build a cause chain explaining why an element is not visible.
   *
   * Strategy:
   * 1. Check the element's own visibility properties
   * 2. Walk up checking for overflow:hidden ancestors that clip
   * 3. Check for opacity:0 ancestors
   * 4. Check for display:none (though these are filtered by extractor)
   */
  buildVisibilityChain(node: LayoutNode, tree: LayoutTree): CauseStep[] {
    const steps: CauseStep[] = [];
    const index = buildNodeIndex(tree);

    // Check the element's own visibility
    for (const prop of VISIBILITY_PROPERTIES) {
      const value = getComputedValue(node, prop);
      if (this.isVisibilityIssue(prop, value)) {
        const ruleSource = this.ruleTracer.traceProperty(node, prop);
        steps.push({
          element: describeElement(node),
          property: prop,
          value,
          ruleSource,
          explanation: this.explainVisibilityIssue(prop, value),
        });
      }
    }

    // Walk up checking ancestors
    const ancestors = getAncestors(node, index);
    const nodeRect = node.boxModel.total;

    for (const ancestor of ancestors) {
      // Check for overflow:hidden that clips this element
      if (
        ancestor.computed.overflowX === "hidden" ||
        ancestor.computed.overflowY === "hidden"
      ) {
        const ancestorRect = ancestor.boxModel.total;
        const isClipped =
          nodeRect.x + nodeRect.width > ancestorRect.x + ancestorRect.width ||
          nodeRect.y + nodeRect.height > ancestorRect.y + ancestorRect.height ||
          nodeRect.x < ancestorRect.x ||
          nodeRect.y < ancestorRect.y;

        if (isClipped) {
          const overflowProp =
            ancestor.computed.overflowX === "hidden" ? "overflow-x" : "overflow-y";
          const ruleSource = this.ruleTracer.traceProperty(ancestor, overflowProp);
          steps.push({
            element: describeElement(ancestor),
            property: overflowProp,
            value: "hidden",
            ruleSource,
            explanation:
              `Ancestor has ${overflowProp}: hidden and the element extends beyond its bounds, ` +
              `causing it to be clipped`,
          });
        }
      }

      // Check for opacity:0 on ancestor
      const ancestorOpacity = parseFloat(ancestor.computed.opacity);
      if (!isNaN(ancestorOpacity) && ancestorOpacity === 0) {
        const ruleSource = this.ruleTracer.traceProperty(ancestor, "opacity");
        steps.push({
          element: describeElement(ancestor),
          property: "opacity",
          value: "0",
          ruleSource,
          explanation: "Ancestor has opacity: 0, making all descendants invisible",
        });
      }

      // Check for clip-path on ancestor
      if (
        ancestor.computed.clipPath &&
        ancestor.computed.clipPath !== "none"
      ) {
        const ruleSource = this.ruleTracer.traceProperty(ancestor, "clip-path");
        steps.push({
          element: describeElement(ancestor),
          property: "clip-path",
          value: ancestor.computed.clipPath,
          ruleSource,
          explanation: `Ancestor has clip-path: ${ancestor.computed.clipPath}, which may clip this element`,
        });
      }

      // Check for zero-height containers
      if (
        ancestor.boxModel.total.height === 0 &&
        ancestor.computed.overflowY === "hidden"
      ) {
        const ruleSource = this.ruleTracer.traceProperty(ancestor, "height");
        steps.push({
          element: describeElement(ancestor),
          property: "height",
          value: ancestor.computed.height,
          ruleSource,
          explanation:
            "Ancestor has zero height with overflow: hidden, effectively hiding all content",
        });
      }
    }

    return steps;
  }

  /**
   * Generic property chain: trace a single CSS property from an element
   * up through its ancestors, reporting each place the property is set.
   */
  buildPropertyChain(
    node: LayoutNode,
    property: string,
    tree: LayoutTree,
  ): CauseStep[] {
    const steps: CauseStep[] = [];
    const index = buildNodeIndex(tree);

    // Check the property on the element itself
    const value = getComputedValue(node, property);
    if (value) {
      const ruleSource = this.ruleTracer.traceProperty(node, property);
      steps.push({
        element: describeElement(node),
        property,
        value,
        ruleSource,
        explanation: `Element has ${property}: ${value}`,
      });
    }

    // Walk up through ancestors
    const ancestors = getAncestors(node, index);
    for (const ancestor of ancestors) {
      const ancestorValue = getComputedValue(ancestor, property);
      if (ancestorValue) {
        const ruleSource = this.ruleTracer.traceProperty(ancestor, property);
        steps.push({
          element: describeElement(ancestor),
          property,
          value: ancestorValue,
          ruleSource,
          explanation: `Ancestor ${describeElement(ancestor)} has ${property}: ${ancestorValue}`,
        });
      }
    }

    return steps;
  }

  // ----- Private helpers -----

  /**
   * Check if a property value is likely contributing to overflow.
   */
  private isOverflowContributor(
    property: string,
    value: string,
    node: LayoutNode,
  ): boolean {
    if (property === "min-width" || property === "min-height") {
      // A fixed min-width/height can force overflow
      return value !== "0px" && value !== "auto";
    }
    if (property === "width" || property === "height") {
      // A fixed width/height larger than parent
      return !value.endsWith("%") && value !== "auto" && value !== "fit-content";
    }
    if (property === "flex-shrink") {
      return value === "0";
    }
    if (property === "white-space") {
      return value === "nowrap" || value === "pre";
    }
    // Padding, margin, border always contribute if non-zero
    return true;
  }

  /**
   * Generate a human-readable explanation for an overflow-causing property.
   */
  private explainOverflowProperty(
    property: string,
    value: string,
    node: LayoutNode,
  ): string {
    const element = describeElement(node);

    switch (property) {
      case "min-width":
        return `${element} has min-width: ${value}, forcing a minimum width that may exceed its container`;
      case "width":
        return `${element} has a fixed width: ${value} that may be wider than its container`;
      case "max-width":
        return `${element} has max-width: ${value}, constraining its width`;
      case "flex-shrink":
        return `${element} has flex-shrink: ${value}, preventing it from shrinking to fit its container`;
      case "white-space":
        return `${element} has white-space: ${value}, preventing text from wrapping and potentially causing horizontal overflow`;
      case "min-height":
        return `${element} has min-height: ${value}, forcing a minimum height that may exceed its container`;
      case "height":
        return `${element} has a fixed height: ${value} that may be taller than its container`;
      default:
        return `${element} has ${property}: ${value}, contributing to element sizing`;
    }
  }

  /**
   * Walk up through parent nodes, recording how each constrains width.
   */
  private traceParentConstraints(
    parent: LayoutNode,
    childWidth: number,
    steps: CauseStep[],
    index: Map<number, LayoutNode>,
  ): void {
    let current: LayoutNode | undefined = parent;
    const maxDepth = 10; // Prevent infinite loops
    let depth = 0;

    while (current && depth < maxDepth) {
      depth++;
      const parentWidth = current.boxModel.total.width;

      // Record the parent's width constraint
      if (current.computed.width && current.computed.width !== "auto") {
        const ruleSource = this.ruleTracer.traceProperty(current, "width");
        steps.push({
          element: describeElement(current),
          property: "width",
          value: current.computed.width,
          ruleSource,
          explanation:
            `Container ${describeElement(current)} has width: ${current.computed.width} ` +
            `(${parentWidth}px computed)${
              childWidth > parentWidth
                ? `, which is narrower than the child (${childWidth}px)`
                : ""
            }`,
        });
      }

      // Record overflow behavior
      if (
        current.computed.overflowX !== "visible" &&
        current.computed.overflowX !== ""
      ) {
        const ruleSource = this.ruleTracer.traceProperty(current, "overflow-x");
        steps.push({
          element: describeElement(current),
          property: "overflow-x",
          value: current.computed.overflowX,
          ruleSource,
          explanation:
            current.computed.overflowX === "hidden"
              ? `Container clips overflowing content (overflow-x: hidden)`
              : `Container handles overflow with overflow-x: ${current.computed.overflowX}`,
        });
      }

      // If this parent fully constrains, stop
      if (
        current.computed.overflowX === "hidden" ||
        current.computed.overflowX === "auto" ||
        current.computed.overflowX === "scroll"
      ) {
        break;
      }

      current = findParent(current, index);
    }
  }

  /**
   * Extract the primary CSS property from a stacking context reason string.
   * E.g., "position: relative; z-index: 5" -> "z-index"
   */
  private extractPrimaryStackingProperty(reason: string): string | undefined {
    // Check each known stacking property
    for (const prop of STACKING_CONTEXT_PROPERTIES) {
      const cssProp = toCSSProperty(prop);
      if (reason.includes(cssProp + ":") || reason.includes(prop + ":")) {
        return cssProp;
      }
    }
    return undefined;
  }

  /**
   * Check if a property value represents a visibility issue.
   */
  private isVisibilityIssue(property: string, value: string): boolean {
    if (property === "visibility" && value === "hidden") return true;
    if (property === "opacity" && parseFloat(value) === 0) return true;
    if (property === "display" && value === "none") return true;
    if (property === "clip-path" && value !== "none" && value !== "") return true;
    if (
      (property === "height" || property === "max-height") &&
      value === "0px"
    )
      return true;
    if (
      (property === "width" || property === "max-width") &&
      value === "0px"
    )
      return true;
    return false;
  }

  /**
   * Generate a human-readable explanation for a visibility issue.
   */
  private explainVisibilityIssue(property: string, value: string): string {
    switch (property) {
      case "visibility":
        return "Element has visibility: hidden, making it invisible but still occupying space";
      case "opacity":
        return "Element has opacity: 0, making it fully transparent";
      case "display":
        return "Element has display: none, removing it from the layout entirely";
      case "clip-path":
        return `Element has clip-path: ${value}, which may clip its visible area`;
      case "height":
      case "max-height":
        return `Element has ${property}: ${value}, collapsing it to zero height`;
      case "width":
      case "max-width":
        return `Element has ${property}: ${value}, collapsing it to zero width`;
      default:
        return `Element has ${property}: ${value}, affecting visibility`;
    }
  }
}
