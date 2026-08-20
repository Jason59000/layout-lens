# Layout Lens — Plan d'exécution

## Vue d'ensemble

| Vague | Nom | Statut | Date |
|-------|-----|--------|------|
| V1 | CDP Core (connection + extractor) | TERMINÉ | 2026-08-20 |
| V2 | Détecteurs (10) + Diagnostics (3) | TERMINÉ | 2026-08-20 |
| V3 | Formatter + Outils MCP + Server | TERMINÉ | 2026-08-20 |
| V3.1 | Batch extraction + query_layout + stabilisation | TERMINÉ | 2026-08-20 |
| V3.2 | Data enrichie + capture_page | TERMINÉ | 2026-08-20 |
| V4 | Monitoring temps réel | EN ATTENTE | — |
| V5 | Features framework-specific | EN ATTENTE | — |
| V6 | Responsive + modes spéciaux | PARTIELLEMENT FAIT | — |
| OS | Open source ready (tests, CI, README, auto-launch) | EN ATTENTE | — |

## Détail V3.1 — Stabilisation (TERMINÉ)

- [x] Batch extraction via `Runtime.evaluate` (~150ms vs minutes)
- [x] `query_layout` MCP tool (7ème outil) avec sandbox `vm.runInNewContext`
- [x] Extraction textContent, color, backgroundColor, fontSize, lineHeight
- [x] Switch inspect_layout/find_issues/get_scroll_tree en mode lightweight
- [x] Pages de benchmark + test infra

## Détail V3.2 — Data enrichie (TERMINÉ)

- [x] `capture_page` MCP tool (8ème outil) — screenshot annoté avec overlays
- [x] Pseudo-éléments (::before/::after) dans batch extract
- [x] Accessibility data (role, aria-label, aria-hidden, tabindex)
- [x] Viewport resize pour test responsive (query_layout + capture_page)
- [x] Event listeners dans inspect_element via DOMDebugger

## V6 — Partiellement fait

- [x] 6a. Viewport resize — intégré dans query_layout et capture_page
- [ ] 6a. Multi-viewport auto (boucle sur breakpoints + diff)
- [ ] 6b. Dark mode comparison
- [ ] 6c. Print layout
- [ ] 6d. RTL

## Vagues

- [V1 — CDP Core](waves/v1-cdp-core.md)
- [V2 — Détecteurs + Diagnostics](waves/v2-detectors-diagnostics.md)
- [V3 — Assemblage final](waves/v3-assembly.md)
- [V4 — Monitoring temps réel](waves/v4-monitoring-realtime.md)
- [V5 — Features framework-specific](waves/v5-framework-specific.md)
- [V6 — Responsive + modes spéciaux](waves/v6-responsive-modes.md)

## 8 outils MCP actuels

| Outil | Mode | Description |
|-------|------|-------------|
| `inspect_layout` | batch | Vue globale + tous les issues |
| `find_issues` | batch | Issues filtrées par catégorie |
| `get_scroll_tree` | batch | Arbre scroll containers + sticky |
| `query_layout` | batch | Queries JS custom + responsive |
| `capture_page` | batch | Screenshot annoté + responsive |
| `inspect_element` | full | Zoom: CSS rules + event listeners |
| `trace_property` | full | Cascade CSS d'une propriété |
| `compare_elements` | full | Diff géométrique |

## Journal de bord

| Date | Événement |
|------|-----------|
| 2026-08-20 | Projet initialisé. Repo GitHub créé (Jason59000/layout-lens). Setup TS + deps. Types définis. |
| 2026-08-20 | V1 lancée — agent en worktree isolé pour connection.ts + extractor.ts |
| 2026-08-20 | V1 TERMINÉE — mergée dans main (d04b483), pushée. 866 lignes ajoutées. |
| 2026-08-20 | V2 lancée — 2 agents parallèles : détecteurs (10) + diagnostics (3) |
| 2026-08-20 | V2 TERMINÉE — 10 détecteurs + 3 modules diagnostics mergés. 3,010 lignes ajoutées. |
| 2026-08-20 | V3 TERMINÉE — formatter + 6 outils MCP + server mergés (e56e9a7), pushée. 1,284 lignes ajoutées. |
| 2026-08-20 | V3.1 — batch extraction (1000x speedup), query_layout, sécurisation new Function→vm sandbox |
| 2026-08-20 | V3.2 — capture_page (screenshot annoté), pseudo-éléments, a11y, responsive, event listeners |
| 2026-08-20 | Discussion A/B test méthodologie, évaluation multi-profil (recruteur, VC, dev, CTO) |
