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

// --- Monitoring types (V4) ---

// Mode 1: post-load analysis (automatic, no user intervention)
export interface PostLoadReport {
  layoutShifts: LayoutShiftEntry[];
  clsScore: number;
  animations: AnimationState[];
  imagesWithoutDimensions: Array<{ selector: string; naturalSize: { width: number; height: number } }>;
}

export interface LayoutShiftEntry {
  score: number;
  timestamp: number;
  sources: Array<{
    selector: string;
    previousRect: Rect;
    currentRect: Rect;
    delta: { x: number; y: number };
  }>;
}

export interface AnimationState {
  selector: string;
  name: string;
  state: "running" | "paused" | "finished" | "idle";
  currentTime: number;
  duration: number;
  stuckSince?: number;
}

// Mode 2: fixed-duration monitoring (LLM calls monitor(duration_ms))
export interface MonitoringResult {
  duration: number;
  snapshotBefore: LayoutTree;
  snapshotAfter: LayoutTree;
  mutationSummary: MutationSummary;
  diff: LayoutDiff;
}

export interface MutationSummary {
  totalMutations: number;
  mutationsPerSecond: number;
  hotElements: Array<{
    selector: string;
    mutationCount: number;
    mutationsPerSecond: number;
    mutationType: "attribute" | "childList" | "mixed";
    pattern?: string;
  }>;
}

export interface LayoutDiff {
  added: string[];
  removed: string[];
  changed: Array<{
    selector: string;
    property: string;
    before: string;
    after: string;
  }>;
  unchangedCount: number;
  changedCount: number;
}

export interface MonitorDetector {
  category: IssueCategory;
  detectPostLoad(report: PostLoadReport): Issue[];
  detectMonitoring(result: MonitoringResult): Issue[];
}
