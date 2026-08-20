import type { LayoutNode } from "../types.js";

const TAILWIND_PATTERN = /^(flex|grid|block|inline|relative|absolute|fixed|sticky|overflow-|z-|w-|h-|p-|m-|gap-|text-|bg-|border-|rounded-)/;

const TAILWIND_MAP: Record<string, Record<string, string>> = {
  overflow: {
    hidden: "overflow-hidden",
    auto: "overflow-auto",
    scroll: "overflow-scroll",
    visible: "overflow-visible",
  },
  "overflow-x": {
    hidden: "overflow-x-hidden",
    auto: "overflow-x-auto",
    scroll: "overflow-x-scroll",
  },
  "overflow-y": {
    hidden: "overflow-y-hidden",
    auto: "overflow-y-auto",
    scroll: "overflow-y-scroll",
  },
  display: {
    flex: "flex",
    grid: "grid",
    block: "block",
    "inline-flex": "inline-flex",
    "inline-block": "inline-block",
    none: "hidden",
  },
  position: {
    relative: "relative",
    absolute: "absolute",
    fixed: "fixed",
    sticky: "sticky",
    static: "static",
  },
  visibility: {
    hidden: "invisible",
    visible: "visible",
  },
  "white-space": {
    nowrap: "whitespace-nowrap",
    normal: "whitespace-normal",
    pre: "whitespace-pre",
    "pre-wrap": "whitespace-pre-wrap",
    "pre-line": "whitespace-pre-line",
    "break-spaces": "whitespace-break-spaces",
  },
  "text-overflow": {
    ellipsis: "text-ellipsis",
    clip: "text-clip",
  },
  "flex-direction": {
    row: "flex-row",
    "row-reverse": "flex-row-reverse",
    column: "flex-col",
    "column-reverse": "flex-col-reverse",
  },
  "flex-wrap": {
    wrap: "flex-wrap",
    nowrap: "flex-nowrap",
    "wrap-reverse": "flex-wrap-reverse",
  },
  "flex-shrink": {
    "0": "shrink-0",
    "1": "shrink",
  },
  "flex-grow": {
    "0": "grow-0",
    "1": "grow",
  },
  "align-items": {
    "flex-start": "items-start",
    "flex-end": "items-end",
    center: "items-center",
    baseline: "items-baseline",
    stretch: "items-stretch",
  },
  "justify-content": {
    "flex-start": "justify-start",
    "flex-end": "justify-end",
    center: "justify-center",
    "space-between": "justify-between",
    "space-around": "justify-around",
    "space-evenly": "justify-evenly",
  },
  "object-fit": {
    contain: "object-contain",
    cover: "object-cover",
    fill: "object-fill",
    none: "object-none",
    "scale-down": "object-scale-down",
  },
  "box-sizing": {
    "border-box": "box-border",
    "content-box": "box-content",
  },
};

export function detectTailwind(nodes: LayoutNode[]): boolean {
  for (const node of nodes) {
    for (const cls of node.classes) {
      if (TAILWIND_PATTERN.test(cls)) return true;
    }
  }
  return false;
}

export function suggestTailwindFix(property: string, currentValue: string, suggestedValue: string): string | null {
  const mapping = TAILWIND_MAP[property];
  if (!mapping) return null;

  const currentClass = mapping[currentValue];
  const suggestedClass = mapping[suggestedValue];

  if (!currentClass && !suggestedClass) return null;

  if (currentClass && suggestedClass) {
    return `${currentClass} → ${suggestedClass}`;
  }

  if (suggestedClass) {
    return `add ${suggestedClass}`;
  }

  return null;
}
