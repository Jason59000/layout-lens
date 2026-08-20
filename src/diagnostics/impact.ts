import type { LayoutNode, LayoutTree } from "../types.js";

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
 * Collect all descendants of a node (including deeply nested).
 */
function collectDescendants(node: LayoutNode): LayoutNode[] {
  const descendants: LayoutNode[] = [];

  function walk(n: LayoutNode): void {
    for (const child of n.children) {
      descendants.push(child);
      walk(child);
    }
  }

  walk(node);
  return descendants;
}

/**
 * Collect all nodes in the tree (flat list).
 */
function collectAllNodes(tree: LayoutTree): LayoutNode[] {
  const nodes: LayoutNode[] = [];

  function walk(node: LayoutNode): void {
    nodes.push(node);
    for (const child of node.children) {
      walk(child);
    }
  }

  walk(tree.root);
  return nodes;
}

/**
 * Build a readable element descriptor from a LayoutNode.
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
 * Check if rect A overlaps rect B.
 */
function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Check if a child rect extends beyond a parent rect, and on which sides.
 */
function getClippedSides(
  childRect: { x: number; y: number; width: number; height: number },
  parentRect: { x: number; y: number; width: number; height: number },
): { right: number; bottom: number; left: number; top: number } {
  return {
    right: Math.max(
      0,
      childRect.x + childRect.width - (parentRect.x + parentRect.width),
    ),
    bottom: Math.max(
      0,
      childRect.y + childRect.height - (parentRect.y + parentRect.height),
    ),
    left: Math.max(0, parentRect.x - childRect.x),
    top: Math.max(0, parentRect.y - childRect.y),
  };
}

/**
 * Get the effective z-index for stacking comparisons.
 * "auto" is treated as 0 for comparison purposes.
 */
function effectiveZIndex(node: LayoutNode): number {
  return node.stacking.zIndex === "auto" ? 0 : node.stacking.zIndex;
}

/**
 * ImpactAnalyzer determines which elements are affected by a layout issue
 * and produces human-readable impact summaries for LLM consumption.
 */
export class ImpactAnalyzer {
  /**
   * Analyze overflow impact: how many children are clipped or hidden
   * by an ancestor with overflow: hidden/auto/scroll.
   *
   * For overflow: hidden, counts children whose bounding rects extend
   * beyond the parent and reports the clipping distances.
   */
  analyzeOverflowImpact(node: LayoutNode, tree: LayoutTree): string {
    const parentRect = node.boxModel.total;
    const descendants = collectDescendants(node);

    if (descendants.length === 0) {
      return "No child elements to analyze for overflow impact.";
    }

    const clippedChildren: Array<{
      node: LayoutNode;
      sides: ReturnType<typeof getClippedSides>;
    }> = [];

    for (const child of descendants) {
      const childRect = child.boxModel.total;
      // Skip zero-size elements
      if (childRect.width === 0 && childRect.height === 0) continue;

      const sides = getClippedSides(childRect, parentRect);
      const isClipped =
        sides.right > 0 || sides.bottom > 0 || sides.left > 0 || sides.top > 0;

      if (isClipped) {
        clippedChildren.push({ node: child, sides });
      }
    }

    if (clippedChildren.length === 0) {
      return "No children extend beyond the container bounds.";
    }

    // Determine the primary clipping direction
    const rightClipped = clippedChildren.filter((c) => c.sides.right > 0);
    const bottomClipped = clippedChildren.filter((c) => c.sides.bottom > 0);
    const leftClipped = clippedChildren.filter((c) => c.sides.left > 0);
    const topClipped = clippedChildren.filter((c) => c.sides.top > 0);

    const parts: string[] = [];

    if (rightClipped.length > 0) {
      const maxClip = Math.max(...rightClipped.map((c) => c.sides.right));
      parts.push(
        `${rightClipped.length} element${rightClipped.length > 1 ? "s" : ""} clipped on the right by up to ${Math.round(maxClip)}px`,
      );
    }

    if (bottomClipped.length > 0) {
      const maxClip = Math.max(...bottomClipped.map((c) => c.sides.bottom));
      parts.push(
        `${bottomClipped.length} element${bottomClipped.length > 1 ? "s" : ""} clipped at the bottom by up to ${Math.round(maxClip)}px`,
      );
    }

    if (leftClipped.length > 0) {
      const maxClip = Math.max(...leftClipped.map((c) => c.sides.left));
      parts.push(
        `${leftClipped.length} element${leftClipped.length > 1 ? "s" : ""} clipped on the left by up to ${Math.round(maxClip)}px`,
      );
    }

    if (topClipped.length > 0) {
      const maxClip = Math.max(...topClipped.map((c) => c.sides.top));
      parts.push(
        `${topClipped.length} element${topClipped.length > 1 ? "s" : ""} clipped at the top by up to ${Math.round(maxClip)}px`,
      );
    }

    const isHidden =
      node.computed.overflowX === "hidden" ||
      node.computed.overflowY === "hidden";

    const overflowBehavior = isHidden
      ? "Content is hidden (overflow: hidden)"
      : "Content is scrollable";

    // List the most significant clipped elements (up to 3)
    const significantClipped = clippedChildren
      .sort(
        (a, b) =>
          Math.max(b.sides.right, b.sides.bottom, b.sides.left, b.sides.top) -
          Math.max(a.sides.right, a.sides.bottom, a.sides.left, a.sides.top),
      )
      .slice(0, 3);

    const elementList = significantClipped
      .map((c) => describeElement(c.node))
      .join(", ");

    return (
      `${clippedChildren.length} of ${descendants.length} descendant elements extend beyond ${describeElement(node)}. ` +
      `${parts.join("; ")}. ${overflowBehavior}. ` +
      `Most affected: ${elementList}.`
    );
  }

  /**
   * Analyze stacking impact: which elements are visually blocking the target.
   *
   * Finds elements that overlap the node's bounding rect and have a higher
   * effective stacking order.
   */
  analyzeStackingImpact(node: LayoutNode, tree: LayoutTree): string {
    const allNodes = collectAllNodes(tree);
    const nodeRect = node.boxModel.total;
    const nodeZ = effectiveZIndex(node);

    // Find the node's stacking context (nearest ancestor that creates one)
    const index = buildNodeIndex(tree);
    const nodeContext = this.findStackingContext(node, index);

    // Find elements that overlap and are visually above this node
    const blockers: LayoutNode[] = [];

    for (const other of allNodes) {
      if (other.nodeId === node.nodeId) continue;
      if (other.boxModel.total.width === 0 && other.boxModel.total.height === 0)
        continue;

      const otherRect = other.boxModel.total;

      // Must overlap geometrically
      if (!rectsOverlap(nodeRect, otherRect)) continue;

      const otherZ = effectiveZIndex(other);
      const otherContext = this.findStackingContext(other, index);

      // If both are in the same stacking context, compare z-index
      if (
        otherContext &&
        nodeContext &&
        otherContext.nodeId === nodeContext.nodeId
      ) {
        if (otherZ > nodeZ) {
          blockers.push(other);
        }
      } else if (otherContext && nodeContext) {
        // Different stacking contexts: compare context z-indices
        const contextZ = effectiveZIndex(otherContext);
        const nodeContextZ = effectiveZIndex(nodeContext);
        if (contextZ > nodeContextZ) {
          blockers.push(other);
        }
      }
    }

    if (blockers.length === 0) {
      return `No elements are visually blocking ${describeElement(node)}.`;
    }

    // Group blockers by their description to avoid repetition
    const blockerDescriptions = [
      ...new Set(blockers.map((b) => describeElement(b))),
    ];
    const displayList = blockerDescriptions.slice(0, 5).join(", ");
    const remaining =
      blockerDescriptions.length > 5
        ? ` and ${blockerDescriptions.length - 5} more`
        : "";

    return (
      `${describeElement(node)} is visually blocked by ${blockers.length} overlapping element${
        blockers.length > 1 ? "s" : ""
      } ` +
      `with higher z-index: ${displayList}${remaining}.`
    );
  }

  /**
   * Analyze the impact of a fixed/sticky element colliding with content.
   *
   * Finds elements that are positioned behind the fixed element
   * and would be hidden or partially obscured.
   */
  analyzeFixedCollisionImpact(
    fixedNode: LayoutNode,
    tree: LayoutTree,
  ): string {
    const fixedRect = fixedNode.boxModel.total;
    const allNodes = collectAllNodes(tree);

    // A fixed element typically sits on top of normal flow content
    const obscuredNodes: LayoutNode[] = [];

    for (const other of allNodes) {
      if (other.nodeId === fixedNode.nodeId) continue;
      if (other.boxModel.total.width === 0 && other.boxModel.total.height === 0)
        continue;

      // Skip elements that are also fixed/sticky (they handle their own stacking)
      if (
        other.computed.position === "fixed" ||
        other.computed.position === "sticky"
      )
        continue;

      const otherRect = other.boxModel.total;

      if (rectsOverlap(fixedRect, otherRect)) {
        obscuredNodes.push(other);
      }
    }

    if (obscuredNodes.length === 0) {
      return `Fixed element ${describeElement(fixedNode)} does not overlap any content.`;
    }

    // Calculate the area of overlap
    const fixedArea = fixedRect.width * fixedRect.height;

    // Count elements that are fully obscured vs partially
    const fullyObscured = obscuredNodes.filter((n) => {
      const r = n.boxModel.total;
      return (
        r.x >= fixedRect.x &&
        r.y >= fixedRect.y &&
        r.x + r.width <= fixedRect.x + fixedRect.width &&
        r.y + r.height <= fixedRect.y + fixedRect.height
      );
    });

    const partiallyObscured = obscuredNodes.length - fullyObscured.length;

    // Identify significant elements (not tiny/insignificant ones)
    const significantElements = obscuredNodes
      .filter((n) => {
        const r = n.boxModel.total;
        return r.width * r.height > 100; // at least 100sq px
      })
      .slice(0, 5);

    const elementList = significantElements
      .map((n) => describeElement(n))
      .join(", ");

    const parts: string[] = [];

    parts.push(
      `Fixed element ${describeElement(fixedNode)} (${Math.round(fixedRect.width)}x${Math.round(fixedRect.height)}px) ` +
        `overlaps ${obscuredNodes.length} element${obscuredNodes.length > 1 ? "s" : ""}`,
    );

    if (fullyObscured.length > 0) {
      parts.push(
        `${fullyObscured.length} fully obscured`,
      );
    }

    if (partiallyObscured > 0) {
      parts.push(`${partiallyObscured} partially obscured`);
    }

    if (elementList) {
      parts.push(`Notable elements behind it: ${elementList}`);
    }

    return parts.join(". ") + ".";
  }

  /**
   * Produce a one-sentence summary of which elements are affected.
   */
  summarizeImpact(affectedNodes: LayoutNode[]): string {
    if (affectedNodes.length === 0) {
      return "No elements are affected.";
    }

    if (affectedNodes.length === 1) {
      return `1 element affected: ${describeElement(affectedNodes[0])}.`;
    }

    // Categorize by tag for a useful summary
    const tagCounts = new Map<string, number>();
    for (const node of affectedNodes) {
      const tag = node.tag;
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }

    // Sort by count descending
    const tagEntries = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);

    // Build a concise summary
    const topTags = tagEntries
      .slice(0, 3)
      .map(([tag, count]) => `${count} <${tag}>`)
      .join(", ");

    const remaining = affectedNodes.length - tagEntries.slice(0, 3).reduce((s, [, c]) => s + c, 0);
    const extra = remaining > 0 ? ` and ${remaining} others` : "";

    return `${affectedNodes.length} elements affected: ${topTags}${extra}.`;
  }

  // ----- Private helpers -----

  /**
   * Find the nearest ancestor that creates a stacking context.
   */
  private findStackingContext(
    node: LayoutNode,
    index: Map<number, LayoutNode>,
  ): LayoutNode | undefined {
    let current = node.parentId !== undefined ? index.get(node.parentId) : undefined;

    while (current) {
      if (current.stacking.createsContext) {
        return current;
      }
      current =
        current.parentId !== undefined
          ? index.get(current.parentId)
          : undefined;
    }

    return undefined;
  }
}
