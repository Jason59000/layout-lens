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
├── detectors/     # 10 issue detectors (overflow, stacking, visibility, etc.)
├── diagnostics/   # Cause chain, CSS rule tracing, impact analysis
├── formatter/     # LLM-friendly text output
├── tools/         # 6 MCP tool implementations
├── types.ts       # Shared types (LayoutNode, BoxModel, Issue, Detector)
└── server.ts      # MCP server entry point
```

## Conventions

- ESM imports with `.js` extensions (Node16 module resolution)
- Each detector implements `Detector` interface from `types.ts`
- Output format is code-like text (key=value, indentation), not JSON
- Diagnostics include cause chains with CSS rule sources (file:line)
- No comments unless the WHY is non-obvious

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
