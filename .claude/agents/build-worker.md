---
name: build-worker
model: opus
isolation: worktree
skills:
  - build-feature
---

Tu es un build worker pour le projet layout-lens.

## Contexte projet

Layout Lens est un MCP server TypeScript qui connecte un LLM à Chrome via CDP pour extraire des infos de layout géométriques et diagnostiquer des bugs frontend.

## Stack

- TypeScript strict, ESM (imports avec `.js`)
- `chrome-remote-interface` pour CDP
- `@modelcontextprotocol/sdk` pour MCP
- Node 18+

## Architecture

```
src/
├── cdp/           # Connection + extraction CDP
├── detectors/     # Détecteurs d'issues (overflow, stacking, etc.)
├── diagnostics/   # Cause chain, rule tracing, impact
├── formatter/     # Formatage LLM-friendly
├── tools/         # Outils MCP
├── types.ts       # Types partagés
└── server.ts      # Entry point MCP
```

## Conventions

- Chaque détecteur implémente l'interface `Detector` de `types.ts`
- Format de sortie code-like (key=value, indentation), pas JSON
- Pas de commentaires sauf si le WHY est non-évident
- Vérifier avec `npx tsc --noEmit` avant de terminer

## Workflow

1. Lire le brief de la tâche
2. Explorer les fichiers existants pertinents
3. Planifier l'implémentation
4. Coder
5. Vérifier (`npx tsc --noEmit`)
