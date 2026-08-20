# Layout Lens

Gives AI agents eyes on the rendered page.

> Your agent can read CSS. It can't see what it renders. Layout Lens connects it to Chrome and gives it the computed layout data — box models, cascades, scroll state, geometry — so together you can debug what source code alone can't explain.

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

### Any element in detail — box model, parent, CSS rules

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
```

The agent now sees the overflow. It knows the parent is 1280px, the table is 1904px, and the content is clipped. It can trace why and suggest a fix.

### The CSS cascade — which rule wins and why

```
trace_property "#data-table" "min-width"

CSS CASCADE: min-width
element: table.data-table

  WINNING: .data-table { min-width: 1904px }  (styles.css:45, specificity: 0-1-0)
  OVERRIDDEN: table { min-width: 100% }  (reset.css:12, specificity: 0-0-1)

Computed value: 1904px
```

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

You interact with the page. Layout Lens records what moves. The agent reads it.

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

That's it. Your agent now has 14 tools to look at the rendered page.

## 14 Tools

### Page snapshot (~150ms)

| Tool | Data |
|------|------|
| `inspect_layout` | Full layout tree — dimensions, display mode, position, framework, Tailwind |
| `get_scroll_tree` | Scroll containers + sticky elements + scroll offsets |
| `query_layout` | Run custom JS queries against the layout tree |
| `capture_page` | Annotated screenshot |

### Element deep-dive

| Tool | Data |
|------|------|
| `inspect_element` | Box model, CSS rules (file:line), event listeners, React component |
| `trace_property` | Full CSS cascade with specificity for one property |
| `compare_elements` | Geometric diff between two elements |

### Monitoring

| Tool | Data |
|------|------|
| `watch_dom_mutations` | DOM changes over a fixed duration |
| `profile_rendering` | FPS, jank frames, frame timing |
| `detect_layout_shifts` | CLS score + which elements shifted |
| `check_animations` | Animation state — running, stuck, hidden |
| `compare_color_schemes` | Light vs dark mode element-by-element diff |
| `check_interactive_states` | Hover/focus feedback check (WCAG 2.4.7) |
| `test_responsive` | 6-viewport sweep — what overflows, what disappears |

## Per element

Geometry, 35+ computed styles, box model (margin/border/padding/content), text content, pseudo-elements (::before/::after), accessibility (role, aria-label, aria-hidden, tabindex), stacking context, scroll state, natural image dimensions, shadow DOM boundaries.

## Enrichments

- **Framework detection** — React, Vue, Angular, Svelte, Next.js, Nuxt
- **React component mapping** — `<div class="css-1a2b3c">` becomes `<ProductCard>` with component hierarchy
- **Tailwind CSS** — detected and noted in layout overview
- **Shadow DOM** — pierced in extraction

## Requirements

- Node.js 18+
- Chrome/Chromium with `--remote-debugging-port=9222`

## License

MIT
