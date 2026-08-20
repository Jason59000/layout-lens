import type {
  BoxModel,
  ComputedStyles,
  Edges,
  LayoutNode,
  LayoutTree,
  Rect,
  ScrollState,
  StackingInfo,
} from "../src/types.js";

let nextNodeId = 1;

export function mockRect(overrides: Partial<Rect> = {}): Rect {
  return { x: 0, y: 0, width: 100, height: 100, ...overrides };
}

export function mockEdges(overrides: Partial<Edges> = {}): Edges {
  return { top: 0, right: 0, bottom: 0, left: 0, ...overrides };
}

export function mockBoxModel(overrides: Partial<BoxModel> = {}): BoxModel {
  return {
    content: mockRect(),
    padding: mockEdges(),
    border: mockEdges(),
    margin: mockEdges(),
    total: mockRect(),
    ...overrides,
  };
}

export function mockScroll(overrides: Partial<ScrollState> = {}): ScrollState {
  return {
    scrollWidth: 100,
    scrollHeight: 100,
    clientWidth: 100,
    clientHeight: 100,
    scrollLeft: 0,
    scrollTop: 0,
    isScrollContainer: false,
    ...overrides,
  };
}

export function mockStacking(overrides: Partial<StackingInfo> = {}): StackingInfo {
  return {
    zIndex: "auto",
    createsContext: false,
    ...overrides,
  };
}

export function mockStyles(overrides: Partial<ComputedStyles> = {}): ComputedStyles {
  return {
    display: "block",
    position: "static",
    float: "none",
    boxSizing: "content-box",
    overflowX: "visible",
    overflowY: "visible",
    zIndex: "auto",
    opacity: "1",
    visibility: "visible",
    transform: "none",
    filter: "none",
    willChange: "auto",
    isolation: "auto",
    clipPath: "none",
    minWidth: "0px",
    maxWidth: "none",
    minHeight: "0px",
    maxHeight: "none",
    width: "auto",
    height: "auto",
    whiteSpace: "normal",
    textOverflow: "clip",
    ...overrides,
  };
}

export function mockNode(overrides: Partial<LayoutNode> = {}): LayoutNode {
  const id = nextNodeId++;
  return {
    nodeId: id,
    tag: "div",
    classes: [],
    selector: "div",
    boxModel: mockBoxModel(),
    computed: mockStyles(),
    scroll: mockScroll(),
    stacking: mockStacking(),
    rules: [],
    children: [],
    ...overrides,
  };
}

export function mockTree(root: LayoutNode, viewport = { width: 1280, height: 720 }): LayoutTree {
  return {
    viewport,
    root,
    timestamp: Date.now(),
  };
}
