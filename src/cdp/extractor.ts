import type { Protocol } from "devtools-protocol";
import { CDPConnection } from "./connection.js";
import type {
  BoxModel,
  ComputedStyles,
  CSSRuleSource,
  Edges,
  LayoutNode,
  LayoutTree,
  Rect,
  ScrollState,
  StackingInfo,
} from "../types.js";

// DOM nodeType constants
const ELEMENT_NODE = 1;

/**
 * Convert a CDP Quad (8 numbers: [x1,y1, x2,y2, x3,y3, x4,y4]) to a Rect.
 * Quads are clock-wise from top-left.
 */
function quadToRect(quad: number[]): Rect {
  // Quad is 4 points clockwise: [x1,y1, x2,y2, x3,y3, x4,y4]
  // Use min/max to handle potentially rotated/transformed quads
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Calculate edges (top, right, bottom, left) between an outer rect and an inner rect.
 */
function calcEdges(outer: Rect, inner: Rect): Edges {
  return {
    top: inner.y - outer.y,
    right: outer.x + outer.width - (inner.x + inner.width),
    bottom: outer.y + outer.height - (inner.y + inner.height),
    left: inner.x - outer.x,
  };
}

/**
 * Convert CDP DOM.BoxModel quads into our BoxModel type.
 *
 * CDP provides: content, padding, border, margin as Quad arrays.
 * We convert to: content Rect, padding/border/margin Edges, total (margin box) Rect.
 */
function convertBoxModel(cdpBox: Protocol.DOM.BoxModel): BoxModel {
  const contentRect = quadToRect(cdpBox.content);
  const paddingRect = quadToRect(cdpBox.padding);
  const borderRect = quadToRect(cdpBox.border);
  const marginRect = quadToRect(cdpBox.margin);

  return {
    content: contentRect,
    padding: calcEdges(paddingRect, contentRect),
    border: calcEdges(borderRect, paddingRect),
    margin: calcEdges(marginRect, borderRect),
    total: marginRect,
  };
}

/**
 * Parse a specificity from a CSS selector.
 * Returns [id, class, type] specificity tuple.
 * This is a simplified heuristic; full CSS specificity parsing is complex.
 */
function estimateSpecificity(selector: string): [number, number, number] {
  // Count #id
  const ids = (selector.match(/#[a-zA-Z_-][\w-]*/g) || []).length;
  // Count .class, [attr], :pseudo-class (but not ::pseudo-element)
  const classes =
    (selector.match(/\.[a-zA-Z_-][\w-]*/g) || []).length +
    (selector.match(/\[/g) || []).length +
    (selector.match(/:(?!:)[a-zA-Z-]+/g) || []).length;
  // Count type selectors and ::pseudo-elements
  const types =
    (selector.match(/(^|[\s>+~])([a-zA-Z][\w-]*)/g) || []).length +
    (selector.match(/::[a-zA-Z-]+/g) || []).length;

  return [ids, classes, types];
}

/**
 * Determine if an element creates a new stacking context based on its computed styles.
 */
function computeStackingInfo(
  computed: ComputedStyles,
  parentDisplay?: string,
): StackingInfo {
  const zIndex = computed.zIndex === "auto" ? "auto" : parseInt(computed.zIndex, 10);
  const reasons: string[] = [];

  const position = computed.position;
  const hasZIndex = computed.zIndex !== "auto";

  // position: absolute|relative|fixed|sticky with z-index != auto
  if (
    (position === "absolute" || position === "relative" || position === "fixed" || position === "sticky") &&
    hasZIndex
  ) {
    reasons.push(`position: ${position}; z-index: ${computed.zIndex}`);
  }

  // position: fixed or sticky always creates a stacking context
  if (position === "fixed" || position === "sticky") {
    if (!reasons.some((r) => r.startsWith("position:"))) {
      reasons.push(`position: ${position}`);
    }
  }

  // opacity < 1
  const opacity = parseFloat(computed.opacity);
  if (!isNaN(opacity) && opacity < 1) {
    reasons.push(`opacity: ${computed.opacity}`);
  }

  // transform != none
  if (computed.transform && computed.transform !== "none") {
    reasons.push(`transform: ${computed.transform}`);
  }

  // filter != none
  if (computed.filter && computed.filter !== "none") {
    reasons.push(`filter: ${computed.filter}`);
  }

  // will-change includes opacity, transform, filter, etc.
  if (computed.willChange && computed.willChange !== "auto") {
    const willChangeProps = computed.willChange.split(",").map((s) => s.trim());
    const contextTriggers = ["opacity", "transform", "filter", "top", "left", "bottom", "right"];
    const triggering = willChangeProps.filter((p) => contextTriggers.includes(p));
    if (triggering.length > 0) {
      reasons.push(`will-change: ${computed.willChange}`);
    }
  }

  // isolation: isolate
  if (computed.isolation === "isolate") {
    reasons.push("isolation: isolate");
  }

  // Flex/grid item with z-index != auto
  if (
    hasZIndex &&
    parentDisplay &&
    (parentDisplay.includes("flex") || parentDisplay.includes("grid"))
  ) {
    reasons.push(`flex/grid item with z-index: ${computed.zIndex}`);
  }

  return {
    zIndex: isNaN(zIndex as number) ? "auto" : zIndex,
    createsContext: reasons.length > 0,
    contextReason: reasons.length > 0 ? reasons.join("; ") : undefined,
  };
}

/**
 * Build a unique CSS selector for a DOM node.
 */
function buildSelector(
  tag: string,
  id: string | undefined,
  classes: string[],
  childIndex: number,
  siblingCount: number,
): string {
  let sel = tag.toLowerCase();

  if (id) {
    sel += `#${id}`;
    return sel; // id should be unique
  }

  if (classes.length > 0) {
    sel += classes.map((c) => `.${c}`).join("");
  }

  // Add :nth-child if needed for disambiguation
  if (siblingCount > 1) {
    sel += `:nth-child(${childIndex})`;
  }

  return sel;
}

/**
 * Extract attributes from a flat [name, value, name, value, ...] array
 * as returned by CDP DOM.Node.attributes.
 */
function parseAttributes(attrs?: string[]): Map<string, string> {
  const map = new Map<string, string>();
  if (!attrs) return map;
  for (let i = 0; i < attrs.length; i += 2) {
    map.set(attrs[i], attrs[i + 1]);
  }
  return map;
}

/**
 * LayoutExtractor uses a CDPConnection to build a complete LayoutTree
 * from the page currently loaded in Chrome.
 */
export class LayoutExtractor {
  private connection: CDPConnection;

  /** Cache of stylesheet source URLs keyed by styleSheetId */
  private stylesheetSources = new Map<string, string>();

  constructor(connection: CDPConnection) {
    this.connection = connection;
  }

  /**
   * Extract the full layout tree from the connected browser page.
   */
  async extractTree(): Promise<LayoutTree> {
    const client = this.connection.client;
    const timestamp = Date.now();

    // Fetch document root and viewport in parallel
    const [docResult, viewportResult] = await Promise.all([
      client.DOM.getDocument({ depth: -1 }),
      client.Runtime.evaluate({
        expression: "JSON.stringify({ width: window.innerWidth, height: window.innerHeight })",
        returnByValue: true,
      }),
    ]);

    const viewport = JSON.parse(viewportResult.result.value as string) as {
      width: number;
      height: number;
    };

    // Collect stylesheet source URLs for rule source mapping
    await this.collectStylesheetSources();

    // The document root (nodeType 9) is not an element itself.
    // Find the <html> element (or first element child) to start traversal.
    const docChildren = docResult.root.children || [];
    const htmlNode = docChildren.find(
      (child) => child.nodeType === ELEMENT_NODE && child.localName === "html",
    ) ?? docChildren.find((child) => child.nodeType === ELEMENT_NODE);

    if (!htmlNode) {
      throw new Error("Failed to extract layout tree: no root element found in document");
    }

    const root = await this.traverseNode(htmlNode, undefined, 1, 1);

    if (!root) {
      throw new Error("Failed to extract layout tree: root element produced no layout");
    }

    return {
      viewport,
      root,
      timestamp,
    };
  }

  /**
   * Collect source URLs for all stylesheets so we can map rules to files.
   * Re-enables the CSS domain briefly to capture styleSheetAdded events,
   * which fire for every known stylesheet upon enable.
   */
  private async collectStylesheetSources(): Promise<void> {
    this.stylesheetSources.clear();
    try {
      const client = this.connection.client;

      // Register a handler for styleSheetAdded to capture headers.
      // CSS.enable() re-emits these events for all known stylesheets.
      const unsubscribe = client.CSS.styleSheetAdded(
        (params: { header: Protocol.CSS.CSSStyleSheetHeader }) => {
          const header = params.header;
          if (header.sourceURL) {
            this.stylesheetSources.set(header.styleSheetId, header.sourceURL);
          }
        },
      );

      // Re-enable CSS domain to trigger styleSheetAdded events
      // (idempotent — safe to call again)
      await client.CSS.enable();

      // Give a brief yield for events to process, then unsubscribe
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      unsubscribe();
    } catch {
      // non-critical — stylesheet source info is optional
    }
  }

  /**
   * Recursively traverse a DOM node and build a LayoutNode.
   * Returns null for non-element nodes or elements that should be skipped.
   */
  private async traverseNode(
    node: Protocol.DOM.Node,
    parentDisplay: string | undefined,
    childIndex: number,
    siblingCount: number,
  ): Promise<LayoutNode | null> {
    // Only process element nodes
    if (node.nodeType !== ELEMENT_NODE) {
      return null;
    }

    const tag = node.localName || node.nodeName.toLowerCase();

    // Skip non-visual elements
    if (tag === "script" || tag === "style" || tag === "link" || tag === "meta" || tag === "noscript") {
      return null;
    }

    const nodeId = node.nodeId;

    // Parse attributes
    const attrs = parseAttributes(node.attributes);
    const id = attrs.get("id") || undefined;
    const classes = attrs.get("class")?.split(/\s+/).filter(Boolean) || [];

    // Get computed styles first to check for display:none
    let computed: ComputedStyles;
    try {
      computed = await this.getComputedStyles(nodeId);
    } catch {
      // If we can't get computed styles, skip this element
      return null;
    }

    // Filter out display:none elements early
    if (computed.display === "none") {
      return null;
    }

    // Build the selector
    const selector = buildSelector(tag, id, classes, childIndex, siblingCount);

    // Get box model, CSS rules, scroll state in parallel
    // Each one is fault-tolerant — a failure won't crash the tree
    const [boxModel, rules, scroll, naturalSize] = await Promise.all([
      this.getBoxModel(nodeId),
      this.getCSSRules(nodeId),
      this.getScrollState(nodeId),
      tag === "img" ? this.getNaturalSize(nodeId) : Promise.resolve(undefined),
    ]);

    // Compute stacking info from computed styles
    const stacking = computeStackingInfo(computed, parentDisplay);

    // Recursively process children
    const children: LayoutNode[] = [];
    const childNodes = node.children || [];
    // Count element children for nth-child calculation
    const elementChildren = childNodes.filter((c: Protocol.DOM.Node) => c.nodeType === ELEMENT_NODE);
    const elementCount = elementChildren.length;

    let elementIndex = 0;
    for (const childNode of childNodes) {
      if (childNode.nodeType === ELEMENT_NODE) {
        elementIndex++;
        try {
          const childLayout = await this.traverseNode(
            childNode,
            computed.display,
            elementIndex,
            elementCount,
          );
          if (childLayout) {
            childLayout.parentId = nodeId;
            children.push(childLayout);
          }
        } catch {
          // Skip children that fail — don't crash the tree
        }
      }
    }

    const layoutNode: LayoutNode = {
      nodeId,
      tag,
      id,
      classes,
      selector,
      boxModel: boxModel ?? emptyBoxModel(),
      computed,
      scroll,
      stacking,
      rules,
      children,
      timestamp: Date.now(),
    };

    if (naturalSize) {
      layoutNode.naturalSize = naturalSize;
    }

    return layoutNode;
  }

  /**
   * Get computed styles for a node, mapped to our ComputedStyles interface.
   */
  private async getComputedStyles(nodeId: number): Promise<ComputedStyles> {
    const client = this.connection.client;
    const { computedStyle } = await client.CSS.getComputedStyleForNode({ nodeId });

    // Build a lookup map from the flat array
    const styleMap = new Map<string, string>();
    for (const prop of computedStyle) {
      styleMap.set(prop.name, prop.value);
    }

    const get = (name: string): string => styleMap.get(name) ?? "";
    const getOpt = (name: string): string | undefined => {
      const v = styleMap.get(name);
      return v !== undefined && v !== "" ? v : undefined;
    };

    const position = get("position");

    const result: ComputedStyles = {
      display: get("display"),
      position,
      float: get("float"),
      boxSizing: get("box-sizing"),
      overflowX: get("overflow-x"),
      overflowY: get("overflow-y"),
      zIndex: get("z-index"),
      opacity: get("opacity"),
      visibility: get("visibility"),
      transform: get("transform"),
      filter: get("filter"),
      willChange: get("will-change"),
      isolation: get("isolation"),
      clipPath: get("clip-path"),
      flexDirection: getOpt("flex-direction"),
      flexWrap: getOpt("flex-wrap"),
      flexShrink: getOpt("flex-shrink"),
      flexGrow: getOpt("flex-grow"),
      alignItems: getOpt("align-items"),
      justifyContent: getOpt("justify-content"),
      gap: getOpt("gap"),
      gridTemplateColumns: getOpt("grid-template-columns"),
      gridTemplateRows: getOpt("grid-template-rows"),
      gridGap: getOpt("grid-gap"),
      minWidth: get("min-width"),
      maxWidth: get("max-width"),
      minHeight: get("min-height"),
      maxHeight: get("max-height"),
      width: get("width"),
      height: get("height"),
      whiteSpace: get("white-space"),
      textOverflow: get("text-overflow"),
      objectFit: getOpt("object-fit"),
    };

    // Position sticky offsets
    if (position === "sticky") {
      result.positionSticky = {
        top: getOpt("top"),
        bottom: getOpt("bottom"),
        left: getOpt("left"),
        right: getOpt("right"),
      };
    }

    return result;
  }

  /**
   * Get the box model for a node. Returns null if the element has no box
   * (e.g., elements with display:contents or elements not in the layout tree).
   */
  private async getBoxModel(nodeId: number): Promise<BoxModel | null> {
    try {
      const client = this.connection.client;
      const { model } = await client.DOM.getBoxModel({ nodeId });
      return convertBoxModel(model);
    } catch {
      // Elements without a box model (display:contents, etc.)
      return null;
    }
  }

  /**
   * Extract CSS rules that apply to a node.
   */
  private async getCSSRules(nodeId: number): Promise<CSSRuleSource[]> {
    try {
      const client = this.connection.client;
      const matched = await client.CSS.getMatchedStylesForNode({ nodeId });
      const rules: CSSRuleSource[] = [];

      // Process matched CSS rules
      if (matched.matchedCSSRules) {
        for (const ruleMatch of matched.matchedCSSRules) {
          const { rule } = ruleMatch;
          const selectorText = rule.selectorList.text;
          const origin = rule.origin;
          const isUserAgent = origin === "user-agent";
          const isInline = false; // matched rules are not inline

          // Get source file info
          let sourceFile: string | undefined;
          let sourceLine: number | undefined;

          if (rule.styleSheetId) {
            sourceFile = this.stylesheetSources.get(rule.styleSheetId);
          }

          if (rule.style.range) {
            sourceLine = rule.style.range.startLine;
          }

          const specificity = estimateSpecificity(selectorText);

          // Extract each property from the rule
          for (const prop of rule.style.cssProperties) {
            if (prop.disabled || prop.name.startsWith("-")) continue;
            if (!prop.value || prop.value === "") continue;

            rules.push({
              selector: selectorText,
              property: prop.name,
              value: prop.value,
              sourceFile,
              sourceLine,
              specificity,
              isInline,
              isInherited: false,
              isUserAgent,
            });
          }
        }
      }

      // Process inline styles
      if (matched.inlineStyle) {
        for (const prop of matched.inlineStyle.cssProperties) {
          if (prop.disabled || prop.name.startsWith("-")) continue;
          if (!prop.value || prop.value === "") continue;

          rules.push({
            selector: "inline",
            property: prop.name,
            value: prop.value,
            specificity: [1, 0, 0],
            isInline: true,
            isInherited: false,
            isUserAgent: false,
          });
        }
      }

      // Process inherited styles
      if (matched.inherited) {
        for (const inherited of matched.inherited) {
          for (const ruleMatch of inherited.matchedCSSRules) {
            const { rule } = ruleMatch;
            const selectorText = rule.selectorList.text;
            const isUserAgent = rule.origin === "user-agent";
            const specificity = estimateSpecificity(selectorText);

            for (const prop of rule.style.cssProperties) {
              if (prop.disabled || prop.name.startsWith("-")) continue;
              if (!prop.value || prop.value === "") continue;

              rules.push({
                selector: selectorText,
                property: prop.name,
                value: prop.value,
                specificity,
                isInline: false,
                isInherited: true,
                isUserAgent,
              });
            }
          }

          // Inherited inline styles
          if (inherited.inlineStyle) {
            for (const prop of inherited.inlineStyle.cssProperties) {
              if (prop.disabled || prop.name.startsWith("-")) continue;
              if (!prop.value || prop.value === "") continue;

              rules.push({
                selector: "inline (inherited)",
                property: prop.name,
                value: prop.value,
                specificity: [1, 0, 0],
                isInline: true,
                isInherited: true,
                isUserAgent: false,
              });
            }
          }
        }
      }

      return rules;
    } catch {
      return [];
    }
  }

  /**
   * Get scroll state for a node via Runtime.evaluate.
   */
  private async getScrollState(nodeId: number): Promise<ScrollState> {
    try {
      const client = this.connection.client;

      // First resolve the node to a remote object
      const { object } = await client.DOM.resolveNode({ nodeId });
      if (!object.objectId) {
        return defaultScrollState();
      }

      const result = await client.Runtime.callFunctionOn({
        objectId: object.objectId,
        functionDeclaration: `function() {
          return JSON.stringify({
            scrollWidth: this.scrollWidth,
            scrollHeight: this.scrollHeight,
            clientWidth: this.clientWidth,
            clientHeight: this.clientHeight,
            scrollLeft: this.scrollLeft,
            scrollTop: this.scrollTop
          });
        }`,
        returnByValue: true,
      });

      // Release the remote object
      if (object.objectId) {
        await client.Runtime.releaseObject({ objectId: object.objectId }).catch(() => {});
      }

      const data = JSON.parse(result.result.value as string) as {
        scrollWidth: number;
        scrollHeight: number;
        clientWidth: number;
        clientHeight: number;
        scrollLeft: number;
        scrollTop: number;
      };

      return {
        scrollWidth: data.scrollWidth,
        scrollHeight: data.scrollHeight,
        clientWidth: data.clientWidth,
        clientHeight: data.clientHeight,
        scrollLeft: data.scrollLeft,
        scrollTop: data.scrollTop,
        isScrollContainer:
          data.scrollWidth > data.clientWidth || data.scrollHeight > data.clientHeight,
      };
    } catch {
      return defaultScrollState();
    }
  }

  /**
   * Get natural size of an image element.
   */
  private async getNaturalSize(
    nodeId: number,
  ): Promise<{ width: number; height: number } | undefined> {
    try {
      const client = this.connection.client;
      const { object } = await client.DOM.resolveNode({ nodeId });
      if (!object.objectId) return undefined;

      const result = await client.Runtime.callFunctionOn({
        objectId: object.objectId,
        functionDeclaration: `function() {
          return JSON.stringify({
            width: this.naturalWidth,
            height: this.naturalHeight
          });
        }`,
        returnByValue: true,
      });

      // Release the remote object
      if (object.objectId) {
        await client.Runtime.releaseObject({ objectId: object.objectId }).catch(() => {});
      }

      const data = JSON.parse(result.result.value as string) as {
        width: number;
        height: number;
      };

      if (data.width === 0 && data.height === 0) return undefined;
      return data;
    } catch {
      return undefined;
    }
  }
}

function defaultScrollState(): ScrollState {
  return {
    scrollWidth: 0,
    scrollHeight: 0,
    clientWidth: 0,
    clientHeight: 0,
    scrollLeft: 0,
    scrollTop: 0,
    isScrollContainer: false,
  };
}

function emptyBoxModel(): BoxModel {
  const zeroRect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  const zeroEdges: Edges = { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    content: zeroRect,
    padding: zeroEdges,
    border: zeroEdges,
    margin: zeroEdges,
    total: zeroRect,
  };
}
