# Layout Lens

Geometric layout representation for LLM frontend debugging, exposed as an MCP server.

> Give your AI agent the same layout data a developer gets from F12 DevTools -- computed styles, box models, overflow detection, and diagnostic cause chains.

## Why

The Chrome DevTools MCP doesn't expose computed styles ([issue #86](https://github.com/anthropics/model-context-protocol/issues/86)). Without layout data, AI agents are blind to rendering bugs -- they can read code but can't see what it produces. Layout Lens fills this gap.

## Quick Start

### With Claude Code

Add to your MCP config (`claude_desktop_config.json` or `.mcp.json`):

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

### Manual

```bash
npm install -g layout-lens
layout-lens  # starts MCP server on stdio
```

## 15 Tools

### Batch (snapshot, ~150ms)

| Tool | Purpose |
|------|---------|
| `inspect_layout` | Full page tree + all detected issues + framework detection |
| `find_issues` | Issues filtered by category + Tailwind suggestions |
| `get_scroll_tree` | Scroll containers + sticky elements |
| `query_layout` | Custom JS queries on layout data |
| `capture_page` | Annotated screenshot with overlay labels |

### Full (per-element, deep)

| Tool | Purpose |
|------|---------|
| `inspect_element` | CSS rules, event listeners, React component mapping |
| `trace_property` | CSS cascade for a specific property |
| `compare_elements` | Geometric diff between two elements |

### Monitoring

| Tool | Purpose |
|------|---------|
| `detect_layout_shifts` | CLS score + shift source elements |
| `check_animations` | Stuck/hidden/running animation status |
| `compare_color_schemes` | Dark/light mode comparison + contrast check |
| `check_interactive_states` | Hover/focus feedback + WCAG 2.4.7 |
| `watch_dom_mutations` | DOM mutations over fixed duration |
| `profile_rendering` | FPS + jank frames + frame distribution |
| `test_responsive` | 6 viewports + overflow/visibility/layout diff |

## What It Extracts

Per element: geometry (x, y, width, height), 35+ computed styles, box model (margin/border/padding/content), text content, pseudo-elements (::before/::after), accessibility attributes, stacking context, scroll state, natural image dimensions, shadow DOM boundaries.

## Enrichments

- **Framework detection** -- React, Vue, Angular, Svelte, Next.js, Nuxt -- shown in `inspect_layout` header
- **React component mapping** -- component name + hierarchy via fiber tree walk in `inspect_element`
- **Tailwind CSS** -- suggests Tailwind class fixes in diagnostics when Tailwind is detected
- **Shadow DOM** -- pierces shadow roots in batch extraction

## 10 Issue Detectors

Overflow, stacking/z-index, visibility, flex/grid, scroll containers, margin collapse, text truncation, image distortion, whitespace gaps, fixed element collisions.

Each issue includes: **what** -- **where** -- **why** (cause chain with CSS rule sources file:line) -- **impact**.

## Example Output

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
