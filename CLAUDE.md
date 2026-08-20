# Layout Lens

Layout observability layer for AI agents — extracts computed layout data from Chrome via CDP, exposed as an MCP server. Provides facts for the agent+dev duo to reason about, not heuristic diagnoses.

## Stack

- TypeScript (strict, ESM)
- `chrome-remote-interface` for CDP
- `@modelcontextprotocol/sdk` for MCP server
- Node 18+

## Architecture

3 layers: CDP extraction → Diagnostics → Formatting/MCP

```
src/
├── cdp/           # Chrome DevTools Protocol connection + extraction
│   ├── connection.ts   # CDP connection lifecycle
│   └── extractor.ts    # Batch + Full extraction, framework detection, shadow DOM
├── diagnostics/   # CSS rule tracing, Tailwind detection
├── formatter/     # LLM-friendly text output (tree view, element detail, cascade)
├── tools/         # 16 MCP tool implementations
├── types.ts       # Shared types (LayoutNode, BoxModel) + tree utility functions
└── server.ts      # MCP server entry point
```

## Three tool modes

- **Batch (lightweight)**: single `Runtime.evaluate` call, ~150ms. No CSS rule sources.
- **Full**: per-element CDP calls, includes CSS rule sources (file:line), event listeners, React component mapping.
- **Monitor**: time-based observation (DOM mutations, frame timing, multi-viewport).

## 16 MCP Tools

| Tool | Mode | Purpose |
|------|------|---------|
| `inspect_layout` | batch | Full page tree + framework detection + Tailwind detection |
| `get_scroll_tree` | batch | Scroll containers + sticky elements |
| `query_layout` | batch | Custom JS queries + responsive + colorScheme |
| `capture_page` | batch | Annotated screenshot + responsive + colorScheme |
| `inspect_element` | full | Deep element inspection (CSS, events, React, hit-test, clipping, fonts, grid/flex, transforms) |
| `trace_property` | full | CSS cascade for a specific property |
| `compare_elements` | full | Geometric diff between two elements |
| `detect_layout_shifts` | snapshot | CLS score + shift source elements |
| `check_animations` | snapshot | Stuck/hidden/running animation status |
| `compare_color_schemes` | snapshot | Dark/light comparison + contrast check |
| `check_interactive_states` | full | Hover/focus feedback + WCAG 2.4.7 |
| `watch_dom_mutations` | monitor | DOM mutations over fixed duration |
| `profile_rendering` | monitor | FPS + jank frames + frame distribution |
| `test_responsive` | multi | 6 viewports + overflow/visibility/layout diff |
| `inspect_accessibility` | full | Full accessibility tree with roles, names, states |
| `get_performance_metrics` | snapshot | JS heap, DOM count, layout/script duration, navigation timing |

## Data extracted per element

Geometry, 40+ computed styles, color/fontSize/lineHeight, textContent, pseudo-elements (::before/::after), accessibility (role, aria-label, aria-hidden, tabindex), stacking contexts, scroll state, natural image sizes, shadow DOM boundaries, containing block.

## Enrichments

- Framework auto-detection (React/Vue/Angular/Svelte/Next.js/Nuxt) in inspect_layout header
- React component name + hierarchy in inspect_element via fiber tree walk
- Tailwind CSS detection in inspect_layout header
- Shadow DOM piercing in batch extraction
- Containing block detection for positioned elements (batch + inspect_element)
- Blended background color (CSS.getBackgroundColors) in inspect_element
- Hit-testing (elementsFromPoint) — what's on top at element center
- Clipping chain — all overflow/clip-path/contain ancestors
- Font metrics (CSS.getPlatformFontsForNode) — actual rendered font
- Interaction state (pointer-events/inert/disabled/aria-disabled)
- Focus info (focusable, tabindex, inert ancestor)
- Scroll ownership chain
- Grid/flex resolved geometry (tracks, items, grow/shrink/basis)
- Transform chain (all ancestor transforms with origin)

## Conventions

- ESM imports with `.js` extensions (Node16 module resolution)
- Output format is code-like text (key=value, indentation), not JSON
- Tree utility functions (walkTree, flattenTree, etc.) live in `types.ts`
- No comments unless the WHY is non-obvious
- `query_layout` expressions run in `vm.runInNewContext` sandbox (not `new Function`)

## Running

```bash
npm run dev      # Start MCP server (tsx)
npm run build    # Compile TypeScript
npm run start    # Run compiled version
npx tsc --noEmit # Type check
```

## Testing with Chrome

Chrome must be started with remote debugging:
```bash
chrome --remote-debugging-port=9222
```
