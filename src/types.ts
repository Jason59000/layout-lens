export interface BoxModel {
  content: Rect;
  padding: Edges;
  border: Edges;
  margin: Edges;
  total: Rect;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Edges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface CSSRuleSource {
  selector: string;
  property: string;
  value: string;
  sourceFile?: string;
  sourceLine?: number;
  specificity: [number, number, number];
  isInline: boolean;
  isInherited: boolean;
  isUserAgent: boolean;
}

export interface ScrollState {
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
  scrollLeft: number;
  scrollTop: number;
  isScrollContainer: boolean;
}

export interface StackingInfo {
  zIndex: number | "auto";
  createsContext: boolean;
  contextReason?: string;
}

export interface ComputedStyles {
  display: string;
  position: string;
  float: string;
  boxSizing: string;
  overflowX: string;
  overflowY: string;
  zIndex: string;
  opacity: string;
  visibility: string;
  transform: string;
  filter: string;
  willChange: string;
  isolation: string;
  clipPath: string;
  flexDirection?: string;
  flexWrap?: string;
  flexShrink?: string;
  flexGrow?: string;
  alignItems?: string;
  justifyContent?: string;
  gap?: string;
  gridTemplateColumns?: string;
  gridTemplateRows?: string;
  gridGap?: string;
  minWidth: string;
  maxWidth: string;
  minHeight: string;
  maxHeight: string;
  width: string;
  height: string;
  whiteSpace: string;
  textOverflow: string;
  objectFit?: string;
  color?: string;
  backgroundColor?: string;
  fontSize?: string;
  lineHeight?: string;
  pointerEvents?: string;
  cursor?: string;
  touchAction?: string;
  contain?: string;
  contentVisibility?: string;
  containerType?: string;
  aspectRatio?: string;
  positionSticky?: {
    top?: string;
    bottom?: string;
    left?: string;
    right?: string;
  };
}

export interface LayoutNode {
  nodeId: number;
  tag: string;
  id?: string;
  classes: string[];
  selector: string;
  boxModel: BoxModel;
  computed: ComputedStyles;
  scroll: ScrollState;
  stacking: StackingInfo;
  rules: CSSRuleSource[];
  children: LayoutNode[];
  parentId?: number;
  timestamp?: number;
  naturalSize?: { width: number; height: number };
  textContent?: string;
  pseudoElements?: Array<{
    type: "before" | "after";
    content: string;
    display: string;
    position: string;
    width: string;
    height: string;
  }>;
  a11y?: {
    role?: string;
    label?: string;
    hidden?: boolean;
    tabIndex?: number;
  };
  shadowRoot?: boolean;
}

export interface LayoutTree {
  viewport: { width: number; height: number };
  root: LayoutNode;
  timestamp: number;
  framework?: { name: string; version?: string; meta?: string };
}


// --- Tree utility functions ---

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

export function findParent(
  node: LayoutNode,
  tree: LayoutTree,
): LayoutNode | null {
  if (node.parentId === undefined) return null;
  const nodeMap = buildNodeMap(tree);
  return nodeMap.get(node.parentId) ?? null;
}

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

export function flattenTree(tree: LayoutTree): LayoutNode[] {
  const nodes: LayoutNode[] = [];
  walkTree(tree, (node) => nodes.push(node));
  return nodes;
}

export function findRuleForProperty(
  node: LayoutNode,
  property: string,
): CSSRuleSource | undefined {
  const matching = node.rules.filter(
    (r) => r.property === property && !r.isUserAgent,
  );
  if (matching.length === 0) {
    return node.rules.find((r) => r.property === property);
  }
  matching.sort((a, b) => compareSpecificity(b.specificity, a.specificity));
  return matching[0];
}

export function formatSelector(node: LayoutNode): string {
  let sel = node.tag;
  if (node.id) sel += `#${node.id}`;
  if (node.classes.length > 0) sel += node.classes.map((c) => `.${c}`).join("");
  return sel;
}

export function parsePx(value: string): number {
  if (!value) return 0;
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}

export function isFlexContainer(node: LayoutNode): boolean {
  const d = node.computed.display;
  return d === "flex" || d === "inline-flex";
}

export function isGridContainer(node: LayoutNode): boolean {
  const d = node.computed.display;
  return d === "grid" || d === "inline-grid";
}

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
