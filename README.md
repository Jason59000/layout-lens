# Layout Lens

Gives AI agents eyes on the rendered page.

> Your agent can read CSS. It can't see what it renders. Layout Lens connects it to Chrome and gives it the computed layout data — box models, cascades, scroll state, geometry, accessibility, performance — so together you can debug what source code alone can't explain.

## Why

When you ask an agent to fix a layout bug, it reads your code and guesses. It doesn't know that the table is actually 1904px wide inside a 1280px container. It can't see that `position: sticky` is silently captured by an ancestor's `overflow: auto`. It has no way to tell that an animation is frozen because the element is `display: none`.

These aren't hard bugs — they're invisible bugs. Invisible because the agent only sees source, not output.

Layout Lens gives it the output.

## How it works

Layout Lens is an MCP server. It connects to Chrome via CDP, extracts the computed layout, and hands it to the agent as structured data. The agent reasons about it. You decide what to fix.

```
Your agent ←→ Layout Lens (MCP) ←→ Chrome (CDP:9222) ←→ Your page
```

## What the agent gets

### The page structure — with real dimensions

```
inspect_layout

PAGE LAYOUT OVERVIEW
viewport: 1280x720
framework: React 18.2.0
css: Tailwind CSS detected

html (1280x720)
├── body (1280x4200)
│   ├── header.navbar (1280x64), sticky
│   ├── main.content (1280x4000), flex-column
│   │   ├── section.hero (1280x400)
│   │   ├── div.grid-container (1280x2400), grid 3-col
│   │   │   ├── div.card (400x300)
│   │   │   ├── div.card (400x300)
│   │   │   └── ... (12 children)
│   │   └── section.footer (1280x200)
```

Not the DOM. The rendered layout with computed sizes, display modes, and positioning.

### Deep element inspection — box model, CSS rules, hit-test, fonts, transforms

```
inspect_element "#data-table"

ELEMENT: table.data-table
selector: html > body > main > section.table-wrapper > table.data-table

BOX MODEL:
  content:  1904 x 600
  padding:  0 16 0 16
  total:    1936 x 600

PARENT RELATIONSHIP:
  parent: section.table-wrapper (1280 x 620)
  element exceeds parent width by 656px
  parent overflow-x: hidden -> content CLIPPED

CONTAINING BLOCK: section.table-wrapper (position: relative)
BACKGROUND: rgba(255,255,255,1) (blended from ancestors)

HIT-TEST:
  receives click: yes (topmost at center)
  ignoring pointer-events: div.overlay (pointer-events: none)

CLIPPING CHAIN:
  section.table-wrapper (overflow: hidden)

FONTS:
  "Inter" (400 glyphs) — actual rendered font
  "Arial" (2 glyphs) — fallback for missing glyphs

GRID/FLEX GEOMETRY:
  parent: flex-row, gap: 16px
  this item: grow=0, shrink=1, basis=auto

CSS VARIABLES:
  --spacing: 16px (from :root)
  --table-bg: white (from .data-table)
```

### The CSS cascade — which rule wins and why

```
trace_property "#data-table" "min-width"

CSS CASCADE: min-width
element: table.data-table

  WINNING: .data-table { min-width: 1904px }  (styles.css:45, specificity: 0-1-0)
  OVERRIDDEN: table { min-width: 100% }  (reset.css:12, specificity: 0-0-1)

Computed value: 1904px
Resolved value: 1904px
```

`trace_property` uses `CSS.resolveValues` to resolve `calc()`, `em`, `%`, and `var()` expressions in the element's context.

### Every viewport at once

```
test_responsive

RESPONSIVE ANALYSIS: 6 viewports tested

320px (mobile S):
  div.code-block overflows viewport by 20px
  div.related-card causes horizontal scroll

768px, 1024px, 1280px, 1920px: clean
```

### DOM activity in real time

```
watch_dom_mutations 5000

HOT ELEMENTS (>10 mutations):
1. div.price-display -- 186 mutations (62/sec)
   types: 180 attribute, 6 childNode
   pattern: continuous attribute updates

TOTAL: 240 DOM mutations in 5.0s (48/sec average)
```

### Computed style changes

```
watch_styles ["width", "height", "transform"]

COMPUTED STYLE WATCH: 3.0s
properties: width, height, transform
total updates: 47

ELEMENTS WITH CHANGES: 3
  div.sidebar: 28 change(s)
  div.content: 15 change(s)
  span.indicator: 4 change(s)

TIMING: changes spread over 2800ms
  rate: ~17 updates/sec
```

Uses `CSS.trackComputedStyleUpdates` — tracks real computed style changes (transitions, animations, media queries), not just DOM mutations.

### Full accessibility tree

```
inspect_accessibility

ACCESSIBILITY TREE: 142 nodes

document "My App"
├── banner
│   ├── link "Home" (focusable)
│   ├── navigation "Main menu"
│   │   ├── link "Products" (focusable)
│   │   └── link "About" (focusable)
│   └── search (focusable)
├── main
│   ├── heading "Welcome" (level=1)
│   └── ...

SUMMARY: 23 focusable, 1 currently focused
WARNING: 2 interactive elements missing accessible name
```

### Performance metrics

```
get_performance_metrics

PERFORMANCE METRICS
  JS heap: 12.4 MB (limit: 4096 MB)
  DOM nodes: 847
  documents: 1
  event listeners: 234
  layout count: 12 (duration: 3.2ms)
  style recalc: 8 (duration: 1.1ms)

NAVIGATION TIMING
  first byte: 120ms
  DOM interactive: 450ms
  DOM content loaded: 520ms
  page load: 1240ms
```

### Rendering profile with compositing layers

```
profile_rendering

RENDERING PROFILE: 3.0s capture
FPS: avg 59fps (target: 60fps)
JANK FRAMES: 2/180 (1.1%)

COMPOSITING LAYERS: 14
  drawing content: 8
  total paint count: 42

MAIN-THREAD SCROLL REASONS:
  layer 3 (1280x4200): RepaintsOnScroll [56 paints]

STICKY CONSTRAINTS (from Blink):
  layer 7: sticky box 0,0 1280x64 in block 0,0 1280x4200
```

### Console output

```
capture_console 5000

CONSOLE CAPTURE: 5.0s
entries: 12, exceptions: 1

EXCEPTIONS: 1
  TypeError: Cannot read properties of undefined (reading 'map') (ProductList.tsx:42)

BY TYPE:
  warn: 7
  error: 3
  log: 2

ENTRIES:
  [error] Failed to fetch /api/products: 500 Internal Server Error (api.ts:15)
  [warn] Each child in a list should have a unique "key" prop. (react-dom.development.js:86)
  [log] [HMR] connected (client.ts:24)
  ...
```

### Network requests

```
capture_network 5000

NETWORK CAPTURE: 5.0s
total requests: 18

FAILED REQUESTS: 1
  GET /api/products
    error: net::ERR_CONNECTION_REFUSED
    type: Fetch

ERROR RESPONSES: 1
  POST /api/auth/refresh → 401 Unauthorized
    type: Fetch

BY TYPE:
  Fetch: 4
  Script: 6
  Stylesheet: 3
  Image: 5

TOTAL TRANSFER: 847.2 KB

SLOWEST REQUESTS:
  1240ms GET /api/products → FAILED
  380ms GET /static/js/main.chunk.js → 200
  120ms GET /static/css/app.css → 200
```

## Quick Start

Add to your MCP config:

```json
{
  "mcpServers": {
    "layout-lens": {
      "command": "npx",
      "args": ["-y", "layout-lens"]
    }
  }
}
```

Start Chrome with remote debugging:

```bash
chrome --remote-debugging-port=9222
```

That's it. Your agent now has 19 tools to look at the rendered page.

## 17 Tools

### Page snapshot (~150ms)

| Tool | Data |
|------|------|
| `inspect_layout` | Full layout tree — dimensions, display mode, position, framework, Tailwind, containing blocks |
| `get_scroll_tree` | Scroll containers + sticky elements + scroll offsets |
| `query_layout` | Run custom JS queries + `findByStyle()` native style search |
| `capture_page` | Annotated screenshot + responsive + colorScheme |

### Element deep-dive

| Tool | Data |
|------|------|
| `inspect_element` | Box model, CSS rules (file:line), event listeners, React component, hit-test, clipping chain, fonts, grid/flex geometry, transforms, inline fragments, interaction state, focus, scroll ownership, containing block, blended background, CSS variables |
| `trace_property` | Full CSS cascade with specificity + `CSS.resolveValues` for calc/em/%/var |
| `compare_elements` | Geometric diff between two elements |

### Monitoring

| Tool | Data |
|------|------|
| `watch_dom_mutations` | DOM changes over a fixed duration |
| `watch_styles` | Computed style changes via `CSS.trackComputedStyleUpdates` |
| `profile_rendering` | FPS, jank, compositing layers (LayerTree), scroll reasons, sticky constraints, paint order |
| `detect_layout_shifts` | CLS score + which elements shifted |
| `check_animations` | Animation state — running, stuck, hidden |
| `compare_color_schemes` | Light vs dark mode element-by-element diff |
| `check_interactive_states` | Hover/focus feedback check (WCAG 2.4.7) |
| `test_responsive` | 6-viewport sweep — what overflows, what disappears |

### Accessibility & Performance

| Tool | Data |
|------|------|
| `inspect_accessibility` | Full AX tree — roles, names, states, focusable count, missing name warnings |
| `get_performance_metrics` | JS heap, DOM nodes, layout/style/script duration, navigation timing |

### Runtime (console & network)

| Tool | Data |
|------|------|
| `capture_console` | Console logs/warns/errors + uncaught exceptions over a time period |
| `capture_network` | HTTP requests, failures, CORS errors, response timing, transfer size |

## Per element

Geometry, 40+ computed styles, box model (margin/border/padding/content), text content, pseudo-elements (::before/::after), accessibility (role, aria-label, aria-hidden, tabindex), stacking context, scroll state, natural image dimensions, shadow DOM boundaries, containing block.

## Enrichments

- **Framework detection** — React, Vue, Angular, Svelte, Next.js, Nuxt
- **React component mapping** — `<div class="css-1a2b3c">` becomes `<ProductCard>` with component hierarchy
- **Tailwind CSS** — detected and noted in layout overview
- **Shadow DOM** — pierced in extraction
- **Containing block** — which ancestor constrains absolute/fixed/sticky elements
- **Blended background** — actual rendered color after ancestor compositing
- **Hit-testing** — native CDP hit-test with `ignorePointerEventsNone`
- **Clipping chain** — every overflow/clip-path/contain ancestor between element and viewport
- **Actual fonts** — which font file the browser used, glyph counts per face
- **Inline fragments** — multi-quads for wrapped/ellipsed inline text
- **Resolved values** — resolve `calc()`, `em`, `%`, `var()` in element context
- **Native style search** — Blink-side filtering by computed style value
- **Compositing layers** — layers, paint counts, scroll reasons, sticky constraints
- **Paint order** — paint order of all rendered elements
- **Style tracking** — real-time computed style change monitoring

## CDP Features Used

Layout Lens goes deep into the Chrome DevTools Protocol to extract data that most tools ignore:

| CDP API | Used in | What it gives |
|---------|---------|---------------|
| `DOM.getNodeForLocation` | `inspect_element` | Native hit-testing with `ignorePointerEventsNone` flag |
| `CSS.getBackgroundColors` | `inspect_element` | Blended background after ancestor compositing |
| `CSS.getPlatformFontsForNode` | `inspect_element` | Actual rendered font family + glyph count per face |
| `CSS.resolveValues` | `trace_property` | Resolve calc/em/%/var in element context |
| `CSS.trackComputedStyleUpdates` | `watch_styles` | Track real computed style changes over time |
| `DOM.getNodesForSubtreeByStyle` | `query_layout` | Native Blink-side style search |
| `DOM.getContentQuads` | `inspect_element` | Multi-quads for inline elements that wrap across lines |
| `DOMSnapshot.captureSnapshot` | `profile_rendering` | Paint order of all elements |
| `LayerTree` domain | `profile_rendering` | Compositing layers, scroll reasons, sticky constraints |
| `Accessibility.getFullAXTree` | `inspect_accessibility` | Complete accessibility tree from Blink |
| `Performance.getMetrics` | `get_performance_metrics` | Runtime perf metrics (heap, layout, script duration) |
| `Runtime.consoleAPICalled` | `capture_console` | Console log/warn/error/info entries |
| `Runtime.exceptionThrown` | `capture_console` | Uncaught JS exceptions with stack traces |
| `Network` domain | `capture_network` | HTTP requests, responses, failures, CORS blocks, timing |

## Requirements

- Node.js 18+
- Chrome/Chromium with `--remote-debugging-port=9222`

## License

MIT
