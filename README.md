# Layout Lens

Geometric layout representation for LLM frontend debugging, exposed as an MCP server.

> AI agents can read your CSS. They can't see what it renders. Layout Lens gives them the computed styles, box models, and diagnostic cause chains that Chrome DevTools MCP doesn't expose ([issue #86](https://github.com/anthropics/model-context-protocol/issues/86)).

## The Problem

Ask an AI agent to fix a layout bug today, and it reads your source code and guesses. It can't see that a table overflows its container, that a sticky header is broken by a parent's `overflow: auto`, or that an animation is stuck because the element is `display: none`.

Layout Lens gives the agent the same data you get from F12 -- but structured for reasoning, not for human eyes.

## Real-World Examples

### "Why is this table cut off?"

The agent reads the code: `width: 100%`. Looks fine. But the rendered table is 1904px inside a 1280px container with `overflow: hidden`. The agent can't know this without computed layout data.

**With Layout Lens** (`find_issues`):
```
ISSUE: horizontal overflow (content clipped)
ELEMENT: table.data-table
  in: body > main > section.table-wrapper > table.data-table
CAUSE CHAIN:
  1. table.data-table has min-width: 1904px
     -> from: .data-table { min-width: 1904px }  (styles.css:45)
  2. parent section.table-wrapper has width: 1280px
     -> from: .table-wrapper { max-width: 100% }  (styles.css:23)
  3. parent has overflow-x: hidden -> content CLIPPED
ROOT CAUSE: min-width: 1904px forces table wider than container
```

The agent now knows exactly which rule to change and where.

### "The sticky header doesn't stick"

Classic cascade bug. `position: sticky` is set, but a grandparent has `overflow-y: auto` -- which silently captures the sticky behavior. The agent would need to walk up every ancestor checking overflow. Manually, that's 10+ minutes of DevTools clicking.

**With Layout Lens** (`trace_property`):
```
ISSUE: position:sticky has no effect
ELEMENT: header.sticky-nav
  position: sticky, top: 0 -- NOT STICKING
CAUSE CHAIN:
  1. header has position: sticky, top: 0
     -> from: .sticky-nav { position: sticky; top: 0 }  (header.css:8)
  2. grandparent main.content has overflow-y: auto
     -> from: .content { overflow-y: auto }  (layout.css:34)
     -> creates scroll container that captures sticky
ROOT CAUSE: ancestor overflow-y:auto captures sticky behavior
```

### "The page breaks on mobile but I don't know where"

The agent can't resize the browser. With Layout Lens, one call tests 6 viewports and diffs the results.

**With Layout Lens** (`test_responsive`):
```
RESPONSIVE ANALYSIS: 6 viewports tested

BREAKAGE AT 320px (mobile S):
  1. div.code-block overflows viewport by 20px
     scroll content: 340px, container: 320px
  2. div.related-card causes horizontal scroll
     scroll content: 128px, container: 320px

ALL CLEAR: 768px, 1024px, 1280px, 1920px

SUMMARY: 2 breakpoints with overflow issues, 4 clean
```

### "Does this page have dark mode issues?"

The agent can't toggle `prefers-color-scheme`. Layout Lens switches modes, screenshots both, and compares every element's colors.

**With Layout Lens** (`compare_color_schemes`):
```
COLOR SCHEME COMPARISON

1. UNCHANGED COLORS (hardcoded?)
   element: div.card
   light: bg=#ffffff, text=#000000
   dark: bg=#ffffff, text=#000000  <- not responding to color scheme

2. LOW CONTRAST (dark mode)
   element: p.subtitle
   color: #333333 on background: #1a1a1a
   contrast ratio: ~1.5:1 (minimum: 4.5:1)

SUMMARY: 45 elements compared, 42 respond to color scheme, 3 issues
```

### "Is there a re-render loop?"

The agent can't see the DOM churning. Layout Lens watches mutations in real time while you interact with the page.

**With Layout Lens** (`watch_dom_mutations`, 5s capture):
```
HOT ELEMENTS (>10 mutations):
1. div.price-display -- 186 mutations (62/sec)
   types: 180 attribute, 6 childNode
   pattern: continuous attribute updates (likely re-render loop)

TOTAL: 240 DOM mutations in 5.0s (48/sec average)
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

## 15 Tools

### Batch (snapshot, ~150ms)

| Tool | What it answers |
|------|----------------|
| `inspect_layout` | "What's on this page? Any layout issues?" |
| `find_issues` | "Show me all the overflow / stacking / visibility bugs" |
| `get_scroll_tree` | "Why is there a double scrollbar?" |
| `query_layout` | "Which elements are wider than 500px?" |
| `capture_page` | "Screenshot with annotations on these selectors" |

### Full (per-element, deep)

| Tool | What it answers |
|------|----------------|
| `inspect_element` | "Why does this element look wrong? Show me every CSS rule." |
| `trace_property` | "Where does this min-width come from? Full cascade." |
| `compare_elements` | "Are these two elements aligned?" |

### Monitoring

| Tool | What it answers |
|------|----------------|
| `detect_layout_shifts` | "What moved after page load?" |
| `check_animations` | "Are any animations stuck or running on hidden elements?" |
| `compare_color_schemes` | "Does dark mode break anything?" |
| `check_interactive_states` | "Do all buttons have hover/focus feedback?" |
| `watch_dom_mutations` | "Is something re-rendering in a loop?" |
| `profile_rendering` | "Is the page janky? What's the FPS?" |
| `test_responsive` | "Does the layout break on mobile/tablet?" |

## What It Extracts

Per element: geometry, 35+ computed styles, box model (margin/border/padding/content), text content, pseudo-elements, accessibility attributes, stacking context, scroll state, natural image dimensions, shadow DOM boundaries.

## Enrichments

- **Framework detection** -- React, Vue, Angular, Svelte, Next.js, Nuxt
- **React component mapping** -- `<div class="css-1a2b3c">` becomes `<ProductCard>`
- **Tailwind CSS** -- suggests Tailwind class fixes in diagnostics
- **Shadow DOM** -- pierces shadow roots in extraction

## 10 Issue Detectors

Overflow, stacking/z-index, visibility, flex/grid, scroll containers, margin collapse, text truncation, image distortion, whitespace gaps, fixed element collisions.

Each issue includes: **what** > **where** > **why** (cause chain with CSS rule source file:line) > **impact**.

## Requirements

- Node.js 18+
- Chrome/Chromium with `--remote-debugging-port=9222`

## Development

```bash
git clone https://github.com/Jason59000/layout-lens.git
cd layout-lens
npm install
npm run dev      # Start MCP server (tsx)
npm run build    # Compile TypeScript
npx tsc --noEmit # Type check
npm test         # Run tests
```

## License

MIT
