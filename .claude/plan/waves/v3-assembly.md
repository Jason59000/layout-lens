# V3 — Assemblage final

## Statut : EN ATTENTE (dépend de V1 + V2)

## Tâches

- [ ] `src/formatter/text.ts` — Formatage LLM-friendly (code-like, hiérarchique, descriptions relatives)
- [ ] `src/tools/inspect-layout.ts` — Vue page complète avec anomalies
- [ ] `src/tools/inspect-element.ts` — Deep dive sur un élément
- [ ] `src/tools/find-issues.ts` — Issues filtrées par catégorie
- [ ] `src/tools/trace-property.ts` — Cascade complète d'une propriété CSS
- [ ] `src/tools/compare-elements.ts` — Diff géométrique entre deux éléments
- [ ] `src/tools/get-scroll-tree.ts` — Arbre des scroll containers + sticky
- [ ] `src/server.ts` — MCP server complet avec tous les outils enregistrés

## Dépendances

- V1 (CDP core) — les outils utilisent CDPConnection + LayoutExtractor
- V2 (détecteurs + diagnostics) — les outils appellent les détecteurs et formatent les diagnostics

## Format de sortie attendu

Voir les exemples dans le plan principal (resilient-honking-pike.md).
Chaque issue suit : QUOI → OÙ → POURQUOI → IMPACT, format code-like (pas JSON).
