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
| OS | Open source ready (tests, CI, README, auto-launch) | EN ATTENTE | — |

## Détail V4 — Monitoring temps réel (TERMINÉ)

- [x] 4a. `detect_layout_shifts` — CLS detection via Performance API
- [x] 4b. `check_animations` — stuck/hidden animation detection
- [x] 4c. `check_interactive_states` — hover/focus pseudo-state testing (WCAG 2.4.7)
- [x] 4d. `watch_dom_mutations` — DOM mutation monitoring over fixed duration
- [x] 4e. `profile_rendering` — frame timing via requestAnimationFrame, jank detection

## Détail V5 — Framework-specific (TERMINÉ)

- [x] 5a. Framework auto-detection (React/Vue/Angular/Svelte/Next.js/Nuxt)
- [x] 5b. React component mapping in inspect_element (fiber tree walk)
- [x] 5e. Shadow DOM piercing in batch extraction
- [x] 5f. Tailwind CSS diagnostic enrichment (suggestTailwindFix)

## Détail V6 — Responsive + modes spéciaux (TERMINÉ)

- [x] 6a. Viewport resize — intégré dans query_layout et capture_page
- [x] 6a. `test_responsive` — multi-viewport auto (6 breakpoints, diff engine)
- [x] 6b. `compare_color_schemes` — dark mode comparison + colorScheme param
- [ ] 6c. Print layout (déprio — niche)
- [ ] 6d. RTL (déprio — marchés spécifiques)

## 15 outils MCP

| Outil | Mode | Description |
|-------|------|-------------|
| `inspect_layout` | batch | Vue globale + tous les issues + framework detection |
| `find_issues` | batch | Issues filtrées par catégorie + Tailwind suggestions |
| `get_scroll_tree` | batch | Arbre scroll containers + sticky |
| `query_layout` | batch | Queries JS custom + responsive + colorScheme |
| `capture_page` | batch | Screenshot annoté + responsive + colorScheme |
| `inspect_element` | full | CSS rules + event listeners + React component |
| `trace_property` | full | Cascade CSS d'une propriété |
| `compare_elements` | full | Diff géométrique |
| `detect_layout_shifts` | snapshot | CLS score + shift sources |
| `check_animations` | snapshot | Animations stuck/hidden/running |
| `compare_color_schemes` | snapshot | Dark/light mode comparison + contrast |
| `check_interactive_states` | full | Hover/focus feedback + WCAG 2.4.7 |
| `watch_dom_mutations` | monitor | DOM mutations over fixed duration |
| `profile_rendering` | monitor | FPS + jank + frame distribution |
| `test_responsive` | multi | 6 viewports + overflow/visibility/layout diff |

## Enrichissements intégrés

- Framework detection dans inspect_layout header
- Tailwind class suggestions dans les diagnostics
- React component name/hierarchy dans inspect_element
- Shadow DOM piercing dans batch extraction
- Pseudo-elements (::before/::after) dans batch extraction
- Accessibility data (role, aria-label, aria-hidden, tabindex)

## Vagues

- [V1 — CDP Core](waves/v1-cdp-core.md)
- [V2 — Détecteurs + Diagnostics](waves/v2-detectors-diagnostics.md)
- [V3 — Assemblage final](waves/v3-assembly.md)
- [V4 — Monitoring temps réel](waves/v4-monitoring-realtime.md)
- [V5 — Features framework-specific](waves/v5-framework-specific.md)
- [V6 — Responsive + modes spéciaux](waves/v6-responsive-modes.md)

## Journal de bord

| Date | Événement |
|------|-----------|
| 2026-08-20 | Projet initialisé. Repo GitHub créé (Jason59000/layout-lens). Setup TS + deps. Types définis. |
| 2026-08-20 | V1 TERMINÉE — connection.ts + extractor.ts. 866 lignes. |
| 2026-08-20 | V2 TERMINÉE — 10 détecteurs + 3 diagnostics. 3,010 lignes. |
| 2026-08-20 | V3 TERMINÉE — formatter + 6 outils MCP + server. 1,284 lignes. |
| 2026-08-20 | V3.1 — batch extraction (1000x speedup), query_layout, vm sandbox |
| 2026-08-20 | V3.2 — capture_page, pseudo-éléments, a11y, responsive, event listeners |
| 2026-08-20 | V4 TERMINÉE — 5 monitoring tools (CLS, animations, hover/focus, DOM mutations, rendering) |
| 2026-08-20 | V5 TERMINÉE — framework detection, React component mapping, Shadow DOM, Tailwind diagnostics |
| 2026-08-20 | V6 TERMINÉE — test_responsive (6 viewports), compare_color_schemes (dark mode) |
