# Layout Lens — Plan d'exécution

## Vue d'ensemble

| Vague | Nom | Statut | Date |
|-------|-----|--------|------|
| V1 | CDP Core (connection + extractor) | TERMINÉ | 2026-08-20 |
| V2 | Détecteurs (10) + Diagnostics (3) | TERMINÉ | 2026-08-20 |
| V3 | Formatter + Outils MCP + Server | TERMINÉ | 2026-08-20 |
| V3.1 | Batch extraction + query_layout + stabilisation | TERMINÉ | 2026-08-20 |
| V3.2 | Data enrichie + capture_page | TERMINÉ | 2026-08-20 |
| V4 | Monitoring temps réel | TERMINÉ | 2026-08-20 |
| V5 | Features framework-specific | TERMINÉ | 2026-08-20 |
| V6 | Responsive + modes spéciaux | TERMINÉ | 2026-08-20 |
| V7 | Refactor observability + enrichissements CSS | TERMINÉ | 2026-08-20 |
| V8 | Deep CDP data (containing block, paint, hit-test) | EN COURS | 2026-08-20 |
| V9 | Nouveaux outils (accessibility, perf metrics) | À FAIRE | — |

## V7 — Refactor observability (TERMINÉ)

- [x] Suppression des 10 détecteurs + find_issues (repositionnement observability)
- [x] Utilities (walkTree, etc.) relocalisées dans types.ts
- [x] Batch 1 : pointer-events, cursor, touch-action, contain, content-visibility, container-type, aspect-ratio
- [x] Batch 2 : media queries + container queries sur CSSRuleSource, CSS variables sur inspect_element
- [x] Fix filtre vendor prefix (permet --custom-properties dans les CSS rules)
- [x] README reécrit (observability layer, pas détection)

## V8 — Deep CDP data (EN COURS)

### Batch 3 — Données structurelles
- [x] 8a. Containing block — quel élément contraint position absolute/fixed/sticky
- [x] 8b. Blended background colors (CSS.getBackgroundColors)
- [ ] 8c. CSS variable provenance graph — chaîne --var → --var → source

### Batch 4 — Hit-testing + clipping
- [x] 8d. Hit-testing réel — elementsFromPoint, topmost element, overlays
- [x] 8e. Clipping chain — tous les ancêtres qui clippent entre élément et viewport

### Batch 5 — Paint + fonts
- [ ] 8f. Paint order (DOMSnapshot includePaintOrder) — ordre réel de peinture
- [x] 8g. Font metrics / fallback (CSS.getPlatformFontsForNode) — police réellement utilisée
- [ ] 8h. Text layout / inline text boxes (DOMSnapshot) — rectangles par ligne, wrap, ellipsis

### Batch 6 — Interaction + focus
- [x] 8i. Focus chain — activeElement, tab order, inert, disabled, focus trap
- [x] 8j. Interaction state — combinaison pointer-events/inert/disabled/aria-disabled/hidden
- [x] 8k. Scroll ownership chain — élément → scroll container → clip → sticky capture

### Batch 7 — Layout avancé
- [ ] 8l. Grid/Flex resolved geometry — tracks résolues, placement items
- [ ] 8m. Layout constraints — pourquoi cet élément fait exactement Npx
- [ ] 8n. Transforms résolues — matrice finale, transform origin, chaîne ancestrale

## V9 — Nouveaux outils

- [ ] 9a. `inspect_accessibility` — arbre AX complet (CDP Accessibility.getFullAXTree)
- [ ] 9b. `get_performance_metrics` — métriques runtime (Performance.getMetrics)
- [ ] 9c. Compositing layers dans profile_rendering (LayerTree)
- [ ] 9d. Main-thread scroll reasons (LayerTree.ScrollRect)
- [ ] 9e. Container queries actives — quels @container matchent
- [ ] 9f. Scroll snap — scroll-snap-type/align + positions résolues
- [ ] 9g. Safe area / visual viewport — layout vs visual viewport, env(safe-area-inset-*)

## 14 outils MCP (après V7)

| Outil | Mode | Description |
|-------|------|-------------|
| `inspect_layout` | batch | Vue globale layout tree + framework + Tailwind |
| `get_scroll_tree` | batch | Arbre scroll containers + sticky |
| `query_layout` | batch | Queries JS custom + responsive + colorScheme |
| `capture_page` | batch | Screenshot annoté + responsive + colorScheme |
| `inspect_element` | full | CSS rules + events + React + CSS variables |
| `trace_property` | full | Cascade CSS + media/container queries |
| `compare_elements` | full | Diff géométrique |
| `detect_layout_shifts` | snapshot | CLS score + shift sources |
| `check_animations` | snapshot | Animations stuck/hidden/running |
| `compare_color_schemes` | snapshot | Dark/light mode comparison + contrast |
| `check_interactive_states` | full | Hover/focus feedback + WCAG 2.4.7 |
| `watch_dom_mutations` | monitor | DOM mutations over fixed duration |
| `profile_rendering` | monitor | FPS + jank + frame distribution |
| `test_responsive` | multi | 6 viewports + overflow/visibility/layout diff |

## Enrichissements intégrés

- Framework detection (React/Vue/Angular/Svelte/Next.js/Nuxt)
- React component name/hierarchy dans inspect_element
- Tailwind CSS detection dans inspect_layout
- Shadow DOM piercing dans batch extraction
- Pseudo-elements (::before/::after)
- Accessibility basique (role, aria-label, aria-hidden, tabindex)
- CSS variables sur inspect_element
- Media queries + container queries sur les CSS rules
- pointer-events, cursor, touch-action, contain, content-visibility, container-type, aspect-ratio

## Journal de bord

| Date | Événement |
|------|-----------|
| 2026-08-20 | Projet initialisé. Repo GitHub créé (Jason59000/layout-lens). |
| 2026-08-20 | V1 TERMINÉE — connection.ts + extractor.ts |
| 2026-08-20 | V2 TERMINÉE — 10 détecteurs + 3 diagnostics |
| 2026-08-20 | V3 TERMINÉE — formatter + 6 outils MCP + server |
| 2026-08-20 | V3.1 — batch extraction, query_layout, vm sandbox |
| 2026-08-20 | V3.2 — capture_page, pseudo-éléments, a11y, responsive |
| 2026-08-20 | V4 TERMINÉE — 5 monitoring tools |
| 2026-08-20 | V5 TERMINÉE — framework detection, React, Shadow DOM, Tailwind |
| 2026-08-20 | V6 TERMINÉE — test_responsive, compare_color_schemes |
| 2026-08-20 | V7 TERMINÉE — suppression détecteurs, repositionnement observability, enrichissements CSS (7 computed styles, media/container queries, CSS variables, fix vendor prefix) |
| 2026-08-20 | V8 EN COURS — deep CDP data |
