import type {
  CSSRuleSource,
  LayoutNode,
  LayoutTree,
} from "../types.js";
import {
  formatSelector,
  walkTree,
  flattenTree,
  findParent,
  getElementPath,
} from "../types.js";
import { detectTailwind } from "../diagnostics/tailwind.js";

// ─── Internal helpers ────────────────────────────────────────

function describeNode(node: LayoutNode): string {
  let label = formatSelector(node);
  if (node.shadowRoot) {
    label += " (shadow root)";
  }
  const w = Math.round(node.boxModel.content.width);
  const h = Math.round(node.boxModel.content.height);
  if (w > 0 || h > 0) {
    label += ` (${w}x${h})`;
  }
  return label;
}

function describeNodeWithHints(node: LayoutNode): string {
  let label = describeNode(node);
  const hints: string[] = [];

  const d = node.computed.display;
  const p = node.computed.position;

  if (p === "fixed") hints.push("fixed");
  else if (p === "sticky") hints.push("sticky");
  else if (p === "absolute") hints.push("absolute");

  if (d === "flex" || d === "inline-flex") {
    const dir = node.computed.flexDirection ?? "row";
    hints.push(`flex-${dir}`);
    if (node.computed.justifyContent && node.computed.justifyContent !== "normal") {
      hints.push(node.computed.justifyContent);
    }
  } else if (d === "grid" || d === "inline-grid") {
    const cols = node.computed.gridTemplateColumns;
    if (cols) {
      const colCount = cols.split(/\s+/).length;
      hints.push(`grid ${colCount}-col`);
    } else {
      hints.push("grid");
    }
  }

  if (hints.length > 0) {
    label += ", " + hints.join(", ");
  }

  return label;
}

function fmtSource(rule: CSSRuleSource): string {
  if (!rule.sourceFile) return "";
  const filename = rule.sourceFile.split("/").pop() ?? rule.sourceFile;
  if (rule.sourceLine !== undefined) return `${filename}:${rule.sourceLine}`;
  return filename;
}

function fmtSpecificity(spec: [number, number, number]): string {
  return `${spec[0]}-${spec[1]}-${spec[2]}`;
}

// ─── Tree rendering ──────────────────────────────────────────

interface TreeLine {
  prefix: string;
  text: string;
}

function renderTree(
  node: LayoutNode,
  prefix: string,
  isLast: boolean,
  depth: number,
  maxDepth: number,
  lines: TreeLine[],
): void {
  const connector = depth === 0 ? "" : isLast ? "└── " : "├── ";
  const label = describeNodeWithHints(node);

  lines.push({ prefix: prefix + connector, text: label });

  if (depth >= maxDepth && node.children.length > 0) {
    const childPrefix = prefix + (depth === 0 ? "" : isLast ? "    " : "│   ");
    lines.push({ prefix: childPrefix + "└── ", text: `... (${node.children.length} children)` });
    return;
  }

  const childPrefix = prefix + (depth === 0 ? "" : isLast ? "    " : "│   ");
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    const childIsLast = i === node.children.length - 1;
    renderTree(child, childPrefix, childIsLast, depth + 1, maxDepth, lines);
  }
}

// ─── Public API ──────────────────────────────────────────────

export function formatLayoutOverview(tree: LayoutTree): string {
  const out: string[] = [];

  out.push("PAGE LAYOUT OVERVIEW");
  out.push(`viewport: ${tree.viewport.width}x${tree.viewport.height}`);
  if (tree.framework) {
    let fwLine = `framework: ${tree.framework.name}`;
    if (tree.framework.version) fwLine += ` ${tree.framework.version}`;
    if (tree.framework.meta) fwLine += ` (${tree.framework.meta})`;
    out.push(fwLine);
  }

  const isTailwind = detectTailwind(flattenTree(tree));
  if (isTailwind) {
    out.push("css: Tailwind CSS detected");
  }

  out.push("");

  const lines: TreeLine[] = [];
  renderTree(tree.root, "", true, 0, 6, lines);
  for (const line of lines) {
    out.push(line.prefix + line.text);
  }

  return out.join("\n");
}

export function formatElement(
  node: LayoutNode,
  tree: LayoutTree,
): string {
  const out: string[] = [];
  const parent = findParent(node, tree);
  const path = getElementPath(node, tree);

  const shadowLabel = node.shadowRoot ? " (shadow root)" : "";
  out.push(`ELEMENT: ${formatSelector(node)}${shadowLabel}`);
  out.push(`selector: ${path}`);
  out.push("");

  const bm = node.boxModel;
  out.push("BOX MODEL:");
  out.push(`  content:  ${Math.round(bm.content.width)} x ${Math.round(bm.content.height)}`);
  out.push(`  padding:  ${bm.padding.top} ${bm.padding.right} ${bm.padding.bottom} ${bm.padding.left}`);
  out.push(`  border:   ${bm.border.top} ${bm.border.right} ${bm.border.bottom} ${bm.border.left}`);
  out.push(`  margin:   ${bm.margin.top} ${bm.margin.right} ${bm.margin.bottom} ${bm.margin.left}`);
  out.push(`  total:    ${Math.round(bm.total.width)} x ${Math.round(bm.total.height)}`);
  out.push("");

  out.push("POSITION:");
  out.push(`  display: ${node.computed.display}`);
  out.push(`  position: ${node.computed.position}`);
  out.push(`  top: ${Math.round(bm.total.y)}  left: ${Math.round(bm.total.x)}`);
  out.push("");

  if (parent) {
    out.push("PARENT RELATIONSHIP:");
    out.push(`  parent: ${formatSelector(parent)} (${Math.round(parent.boxModel.content.width)} x ${Math.round(parent.boxModel.content.height)})`);

    const widthDiff = Math.round(bm.total.width - parent.boxModel.content.width);
    const heightDiff = Math.round(bm.total.height - parent.boxModel.content.height);

    if (widthDiff > 0) {
      out.push(`  element exceeds parent width by ${widthDiff}px`);
      if (parent.computed.overflowX === "hidden") {
        out.push("  parent overflow-x: hidden -> content CLIPPED");
      } else if (parent.computed.overflowX === "auto" || parent.computed.overflowX === "scroll") {
        out.push(`  parent overflow-x: ${parent.computed.overflowX} -> content SCROLLABLE`);
      } else {
        out.push("  parent overflow-x: visible -> content BLEEDS");
      }
    }

    if (heightDiff > 0) {
      out.push(`  element exceeds parent height by ${heightDiff}px`);
      if (parent.computed.overflowY === "hidden") {
        out.push("  parent overflow-y: hidden -> content CLIPPED");
      } else if (parent.computed.overflowY === "auto" || parent.computed.overflowY === "scroll") {
        out.push(`  parent overflow-y: ${parent.computed.overflowY} -> content SCROLLABLE`);
      }
    }

    out.push("");
  }

  out.push("STACKING:");
  const zDisplay = node.stacking.zIndex === "auto" ? "auto" : String(node.stacking.zIndex);
  const contextNote = node.stacking.createsContext
    ? `creates stacking context: ${node.stacking.contextReason}`
    : "no stacking context";
  out.push(`  z-index: ${zDisplay} (${contextNote})`);
  out.push("");

  out.push("COMPUTED (relevant):");
  out.push(`  box-sizing: ${node.computed.boxSizing}`);

  const relevantProps: Array<[string, string | undefined]> = [
    ["min-width", node.computed.minWidth],
    ["max-width", node.computed.maxWidth],
    ["min-height", node.computed.minHeight],
    ["max-height", node.computed.maxHeight],
    ["overflow-x", node.computed.overflowX],
    ["overflow-y", node.computed.overflowY],
    ["white-space", node.computed.whiteSpace],
    ["text-overflow", node.computed.textOverflow],
  ];

  if (node.computed.display === "flex" || node.computed.display === "inline-flex") {
    relevantProps.push(
      ["flex-direction", node.computed.flexDirection],
      ["flex-wrap", node.computed.flexWrap],
      ["align-items", node.computed.alignItems],
      ["justify-content", node.computed.justifyContent],
      ["gap", node.computed.gap],
    );
  }

  if (node.computed.display === "grid" || node.computed.display === "inline-grid") {
    relevantProps.push(
      ["grid-template-columns", node.computed.gridTemplateColumns],
      ["grid-template-rows", node.computed.gridTemplateRows],
      ["grid-gap", node.computed.gridGap],
    );
  }

  if (node.computed.transform && node.computed.transform !== "none") {
    relevantProps.push(["transform", node.computed.transform]);
  }
  if (node.computed.opacity !== "1") {
    relevantProps.push(["opacity", node.computed.opacity]);
  }
  if (node.computed.objectFit) {
    relevantProps.push(["object-fit", node.computed.objectFit]);
  }
  if (node.computed.pointerEvents && node.computed.pointerEvents !== "auto") {
    relevantProps.push(["pointer-events", node.computed.pointerEvents]);
  }
  if (node.computed.cursor) {
    relevantProps.push(["cursor", node.computed.cursor]);
  }
  if (node.computed.touchAction && node.computed.touchAction !== "auto") {
    relevantProps.push(["touch-action", node.computed.touchAction]);
  }
  if (node.computed.contain && node.computed.contain !== "none") {
    relevantProps.push(["contain", node.computed.contain]);
  }
  if (node.computed.contentVisibility && node.computed.contentVisibility !== "visible") {
    relevantProps.push(["content-visibility", node.computed.contentVisibility]);
  }
  if (node.computed.containerType && node.computed.containerType !== "normal") {
    relevantProps.push(["container-type", node.computed.containerType]);
  }
  if (node.computed.aspectRatio && node.computed.aspectRatio !== "auto") {
    relevantProps.push(["aspect-ratio", node.computed.aspectRatio]);
  }

  for (const [prop, val] of relevantProps) {
    if (val && val !== "visible" && val !== "auto" && val !== "none" && val !== "normal" && val !== "0px") {
      out.push(`  ${prop}: ${val}`);
    }
  }

  if (node.naturalSize) {
    out.push("");
    out.push("NATURAL SIZE (image):");
    out.push(`  intrinsic: ${node.naturalSize.width} x ${node.naturalSize.height}`);
    out.push(`  rendered:  ${Math.round(bm.content.width)} x ${Math.round(bm.content.height)}`);
    const ratioNatural = node.naturalSize.width / node.naturalSize.height;
    const ratioRendered = bm.content.width / bm.content.height;
    if (Math.abs(ratioNatural - ratioRendered) > 0.05) {
      out.push(`  aspect ratio distorted: natural=${ratioNatural.toFixed(2)}, rendered=${ratioRendered.toFixed(2)}`);
    }
  }

  return out.join("\n");
}

export function formatPropertyTrace(
  node: LayoutNode,
  property: string,
  rules: CSSRuleSource[],
): string {
  const out: string[] = [];

  out.push(`CSS CASCADE: ${property}`);
  out.push(`element: ${formatSelector(node)}`);
  out.push("");

  if (rules.length === 0) {
    out.push("No CSS rules found for this property.");
    out.push(`Computed value: ${getComputedProp(node, property)}`);
    return out.join("\n");
  }

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const label = i === 0 ? "WINNING" : rule.isUserAgent ? "USER-AGENT" : rule.isInherited ? "INHERITED" : "OVERRIDDEN";
    const src = fmtSource(rule);
    const spec = fmtSpecificity(rule.specificity);
    const important = rule.value.includes("!important") ? " !important" : "";

    let line = `  ${label}: ${rule.selector} { ${property}: ${rule.value.replace(/\s*!important\s*/, "")}${important} }`;

    if (!rule.isUserAgent) {
      const meta: string[] = [];
      if (src) meta.push(src);
      meta.push(`specificity: ${spec}`);
      if (rule.isInherited) meta.push("inherited");
      if (meta.length > 0) line += `  (${meta.join(", ")})`;
    }

    out.push(line);
  }

  out.push("");
  out.push(`Computed value: ${getComputedProp(node, property)}`);

  return out.join("\n");
}

export function formatComparison(a: LayoutNode, b: LayoutNode): string {
  const out: string[] = [];

  out.push("ELEMENT COMPARISON");
  out.push(`  A: ${formatSelector(a)}`);
  out.push(`  B: ${formatSelector(b)}`);
  out.push("");

  out.push("GEOMETRY:");
  diffLine(out, "content width", Math.round(a.boxModel.content.width), Math.round(b.boxModel.content.width));
  diffLine(out, "content height", Math.round(a.boxModel.content.height), Math.round(b.boxModel.content.height));
  diffLine(out, "total width", Math.round(a.boxModel.total.width), Math.round(b.boxModel.total.height));
  diffLine(out, "total height", Math.round(a.boxModel.total.height), Math.round(b.boxModel.total.height));
  diffLine(out, "x", Math.round(a.boxModel.total.x), Math.round(b.boxModel.total.x));
  diffLine(out, "y", Math.round(a.boxModel.total.y), Math.round(b.boxModel.total.y));
  out.push("");

  out.push("PADDING:");
  diffLine(out, "top", a.boxModel.padding.top, b.boxModel.padding.top);
  diffLine(out, "right", a.boxModel.padding.right, b.boxModel.padding.right);
  diffLine(out, "bottom", a.boxModel.padding.bottom, b.boxModel.padding.bottom);
  diffLine(out, "left", a.boxModel.padding.left, b.boxModel.padding.left);
  out.push("");

  out.push("MARGIN:");
  diffLine(out, "top", a.boxModel.margin.top, b.boxModel.margin.top);
  diffLine(out, "right", a.boxModel.margin.right, b.boxModel.margin.right);
  diffLine(out, "bottom", a.boxModel.margin.bottom, b.boxModel.margin.bottom);
  diffLine(out, "left", a.boxModel.margin.left, b.boxModel.margin.left);
  out.push("");

  out.push("COMPUTED STYLES:");
  const propsToCompare: Array<[string, string, string]> = [
    ["display", a.computed.display, b.computed.display],
    ["position", a.computed.position, b.computed.position],
    ["box-sizing", a.computed.boxSizing, b.computed.boxSizing],
    ["overflow-x", a.computed.overflowX, b.computed.overflowX],
    ["overflow-y", a.computed.overflowY, b.computed.overflowY],
    ["z-index", a.computed.zIndex, b.computed.zIndex],
    ["opacity", a.computed.opacity, b.computed.opacity],
    ["visibility", a.computed.visibility, b.computed.visibility],
    ["min-width", a.computed.minWidth, b.computed.minWidth],
    ["max-width", a.computed.maxWidth, b.computed.maxWidth],
    ["min-height", a.computed.minHeight, b.computed.minHeight],
    ["max-height", a.computed.maxHeight, b.computed.maxHeight],
    ["white-space", a.computed.whiteSpace, b.computed.whiteSpace],
  ];

  let hasDiff = false;
  for (const [prop, valA, valB] of propsToCompare) {
    if (valA !== valB) {
      out.push(`  ${prop}: A=${valA}  B=${valB}  <- DIFFERENT`);
      hasDiff = true;
    }
  }
  if (!hasDiff) {
    out.push("  (all compared properties are identical)");
  }

  out.push("");
  out.push("STACKING:");
  const zA = a.stacking.zIndex === "auto" ? "auto" : String(a.stacking.zIndex);
  const zB = b.stacking.zIndex === "auto" ? "auto" : String(b.stacking.zIndex);
  if (zA !== zB) {
    out.push(`  z-index: A=${zA}  B=${zB}  <- DIFFERENT`);
  } else {
    out.push(`  z-index: ${zA} (same)`);
  }
  out.push(`  A creates stacking context: ${a.stacking.createsContext}`);
  out.push(`  B creates stacking context: ${b.stacking.createsContext}`);

  return out.join("\n");
}

export function formatScrollTree(tree: LayoutTree): string {
  const out: string[] = [];

  out.push("SCROLL CONTAINER TREE");
  out.push(`viewport: ${tree.viewport.width}x${tree.viewport.height}`);
  out.push("");

  const scrollContainers: LayoutNode[] = [];
  const stickyElements: LayoutNode[] = [];

  walkTree(tree, (node) => {
    if (node.scroll.isScrollContainer) {
      scrollContainers.push(node);
    }
    if (node.computed.position === "sticky") {
      stickyElements.push(node);
    }
  });

  if (scrollContainers.length === 0) {
    out.push("No scroll containers detected.");
  } else {
    out.push(`SCROLL CONTAINERS: ${scrollContainers.length}`);
    out.push("");

    for (const sc of scrollContainers) {
      const label = formatSelector(sc);
      const scrollX = sc.scroll.scrollWidth > sc.scroll.clientWidth;
      const scrollY = sc.scroll.scrollHeight > sc.scroll.clientHeight;
      const dirs: string[] = [];
      if (scrollX) dirs.push(`horizontal: ${sc.scroll.scrollWidth}px content in ${sc.scroll.clientWidth}px`);
      if (scrollY) dirs.push(`vertical: ${sc.scroll.scrollHeight}px content in ${sc.scroll.clientHeight}px`);

      out.push(`  ${label}`);
      out.push(`    overflow: ${sc.computed.overflowX} / ${sc.computed.overflowY}`);
      for (const dir of dirs) {
        out.push(`    ${dir}`);
      }
      if (sc.scroll.scrollLeft > 0 || sc.scroll.scrollTop > 0) {
        out.push(`    scrolled: left=${sc.scroll.scrollLeft} top=${sc.scroll.scrollTop}`);
      }
      out.push("");
    }
  }

  if (stickyElements.length > 0) {
    out.push(`STICKY ELEMENTS: ${stickyElements.length}`);
    out.push("");

    for (const se of stickyElements) {
      const label = formatSelector(se);
      const offsets = se.computed.positionSticky;
      const offsetParts: string[] = [];
      if (offsets?.top) offsetParts.push(`top: ${offsets.top}`);
      if (offsets?.bottom) offsetParts.push(`bottom: ${offsets.bottom}`);
      if (offsets?.left) offsetParts.push(`left: ${offsets.left}`);
      if (offsets?.right) offsetParts.push(`right: ${offsets.right}`);

      out.push(`  ${label}`);
      if (offsetParts.length > 0) {
        out.push(`    sticky offsets: ${offsetParts.join(", ")}`);
      }
    }
  }

  return out.join("\n");
}

// ─── Private helpers ─────────────────────────────────────────

function diffLine(out: string[], label: string, a: number, b: number): void {
  if (a === b) {
    out.push(`  ${label}: ${a} (same)`);
  } else {
    const diff = b - a;
    const sign = diff > 0 ? "+" : "";
    out.push(`  ${label}: A=${a}  B=${b}  (${sign}${diff})`);
  }
}

function getComputedProp(node: LayoutNode, cssProp: string): string {
  const camelCase = cssProp.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  const computed = node.computed as unknown as Record<string, string | undefined>;
  return computed[camelCase] ?? "(not set)";
}
