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
}

export interface LayoutTree {
  viewport: { width: number; height: number };
  root: LayoutNode;
  timestamp: number;
}

export type IssueCategory =
  | "overflow"
  | "stacking"
  | "visibility"
  | "flex-grid"
  | "scroll"
  | "margin-collapse"
  | "text-truncation"
  | "image-distortion"
  | "whitespace"
  | "fixed-collision";

export type IssueSeverity = "error" | "warning" | "info";

export interface CauseStep {
  element: string;
  property: string;
  value: string;
  ruleSource?: CSSRuleSource;
  explanation: string;
}

export interface Issue {
  category: IssueCategory;
  severity: IssueSeverity;
  summary: string;
  element: LayoutNode;
  elementPath: string;
  causeChain: CauseStep[];
  rootCause: {
    description: string;
    source?: CSSRuleSource;
  };
  impact?: string;
  relatedNodes?: LayoutNode[];
}

export interface Detector {
  category: IssueCategory;
  detect(tree: LayoutTree): Issue[];
}
