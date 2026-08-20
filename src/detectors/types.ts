import type { CSSRuleSource, LayoutNode, LayoutTree } from "../types.js";

/**
 * Build an element path string from root to the given node.
 * Example: "html > body > main > div.container > p.intro"
 */
export function getElementPath(node: LayoutNode, tree: LayoutTree): string {
  const segments: string[] = [];
  const nodeMap = buildNodeMap(tree);

  let current: LayoutNode | undefined = node;
  while (current) {
    segments.unshift(formatSelector(current));
    if (current.parentId !== undefined) {
      current = nodeMap.get(current.parentId);
    } else {
      break;
    }
  }
  return segments.join(" > ");
}

/**
 * Find the parent node in the tree.
 */
export function findParent(
  node: LayoutNode,
  tree: LayoutTree,
): LayoutNode | null {
  if (node.parentId === undefined) return null;
  const nodeMap = buildNodeMap(tree);
  return nodeMap.get(node.parentId) ?? null;
}

/**
 * Walk all nodes in the tree depth-first, calling the callback for each.
 */
export function walkTree(
  tree: LayoutTree,
  callback: (node: LayoutNode, parent?: LayoutNode) => void,
): void {
  function visit(node: LayoutNode, parent?: LayoutNode): void {
    callback(node, parent);
    for (const child of node.children) {
      visit(child, node);
    }
  }
  visit(tree.root);
}

/**
 * Collect all nodes into a flat array.
 */
export function flattenTree(tree: LayoutTree): LayoutNode[] {
  const nodes: LayoutNode[] = [];
  walkTree(tree, (node) => nodes.push(node));
  return nodes;
}

/**
 * Find a CSS rule source for a specific property on a node.
 * Returns the highest-specificity non-user-agent rule, or falls back to any rule.
 */
export function findRuleForProperty(
  node: LayoutNode,
  property: string,
): CSSRuleSource | undefined {
  const matching = node.rules.filter(
    (r) => r.property === property && !r.isUserAgent,
  );
  if (matching.length === 0) {
    // Fall back to user-agent rules
    return node.rules.find((r) => r.property === property);
  }
  // Return highest specificity
  matching.sort((a, b) => compareSpecificity(b.specificity, a.specificity));
  return matching[0];
}

/**
 * Format a node's selector for display (tag#id.class1.class2).
 */
export function formatSelector(node: LayoutNode): string {
  let sel = node.tag;
  if (node.id) sel += `#${node.id}`;
  if (node.classes.length > 0) sel += node.classes.map((c) => `.${c}`).join("");
  return sel;
}

/**
 * Get computed style value as a number (parsing px values).
 * Returns 0 if the value is not numeric.
 */
export function parsePx(value: string): number {
  if (!value) return 0;
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}

/**
 * Check if a node is a flex container.
 */
export function isFlexContainer(node: LayoutNode): boolean {
  const d = node.computed.display;
  return d === "flex" || d === "inline-flex";
}

/**
 * Check if a node is a grid container.
 */
export function isGridContainer(node: LayoutNode): boolean {
  const d = node.computed.display;
  return d === "grid" || d === "inline-grid";
}

// --- Internal helpers ---

function buildNodeMap(tree: LayoutTree): Map<number, LayoutNode> {
  const map = new Map<number, LayoutNode>();
  walkTree(tree, (node) => map.set(node.nodeId, node));
  return map;
}

function compareSpecificity(
  a: [number, number, number],
  b: [number, number, number],
): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}
