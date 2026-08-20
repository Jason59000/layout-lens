# Layout Lens

Geometric layout representation tool for LLM frontend debugging, exposed as an MCP server.

## Stack

- TypeScript (strict, ESM)
- `chrome-remote-interface` for CDP
- `@modelcontextprotocol/sdk` for MCP server
- Node 18+

## Architecture

4 layers: CDP extraction → Detection → Diagnostics → Formatting/MCP

```
src/
├── cdp/           # Chrome DevTools Protocol connection + extraction
│   ├── connection.ts   # CDP connection lifecycle
│   └── extractor.ts    # Batch (lightweight) + Full extraction modes
├── detectors/     # 10 issue detectors (overflow, stacking, visibility, etc.)
├── diagnostics/   # Cause chain, CSS rule tracing, impact analysis
├── formatter/     # LLM-friendly text output
├── tools/         # 8 MCP tool implementations
├── types.ts       # Shared types (LayoutNode, BoxModel, Issue, Detector)
└── server.ts      # MCP server entry point
```

## Two extraction modes

- **Batch (lightweight)**: single `Runtime.evaluate` call, ~150ms on large pages. Used by `inspect_layout`, `find_issues`, `get_scroll_tree`, `query_layout`, `capture_page`. No CSS rule sources.
- **Full**: per-element CDP calls, includes CSS rule sources (file:line) and event listeners. Used by `inspect_element`, `trace_property`, `compare_elements`.

## 8 MCP Tools

| Tool | Mode | Purpose |
|------|------|---------|
| `inspect_layout` | batch | Full page tree + all detected issues |
| `find_issues` | batch | Issues filtered by category |
| `get_scroll_tree` | batch | Scroll containers + sticky elements |
| `query_layout` | batch | Custom JS queries on layout data + responsive |
| `capture_page` | batch | Annotated screenshot with overlay labels |
| `inspect_element` | full | Deep inspection: CSS rules, event listeners |
| `trace_property` | full | CSS cascade for a specific property |
| `compare_elements` | full | Geometric diff between two elements |

## Data extracted per element

Geometry, 35+ computed styles, color/fontSize/lineHeight, textContent, pseudo-elements (::before/::after), accessibility (role, aria-label, aria-hidden, tabindex), stacking contexts, scroll state, natural image sizes.

## Conventions

- ESM imports with `.js` extensions (Node16 module resolution)
- Each detector implements `Detector` interface from `types.ts`
- Output format is code-like text (key=value, indentation), not JSON
- Diagnostics include cause chains with CSS rule sources (file:line)
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
