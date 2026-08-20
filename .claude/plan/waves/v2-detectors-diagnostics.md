# V2 — Détecteurs + Diagnostics

## Statut : EN ATTENTE (dépend de V1)

## Tâches

### Détecteurs (10) — un agent
- [ ] `src/detectors/types.ts` — Interface Detector commune
- [ ] `src/detectors/overflow.ts` — Overflow horizontal, vertical, viewport protrusion
- [ ] `src/detectors/stacking.ts` — Stacking contexts, z-index ineffectif
- [ ] `src/detectors/visibility.ts` — Hidden, clipped, off-viewport
- [ ] `src/detectors/flex-grid.ts` — Shrink inattendu, wrap, sizing
- [ ] `src/detectors/scroll.ts` — Scroll containers imbriqués, sticky breakage, double scrollbar
- [ ] `src/detectors/margin-collapse.ts` — Margins adjacentes qui fusionnent
- [ ] `src/detectors/text-truncation.ts` — Texte tronqué/ellipsis
- [ ] `src/detectors/image-distortion.ts` — Image déformée, ratio cassé
- [ ] `src/detectors/whitespace.ts` — Gap inattendu entre éléments
- [ ] `src/detectors/fixed-collision.ts` — Contenu caché derrière fixed/sticky

### Diagnostics (3) — un agent en parallèle
- [ ] `src/diagnostics/rule-tracer.ts` — Résolution CSS rule source (fichier, ligne, spécificité)
- [ ] `src/diagnostics/cause-chain.ts` — Construction chaîne causale pour chaque issue
- [ ] `src/diagnostics/impact.ts` — Analyse d'impact (quels éléments affectés)

## Dépendances

- V1 (CDP core) — les détecteurs consomment le LayoutTree produit par l'extractor
- Les détecteurs et diagnostics sont indépendants entre eux → parallélisables

## Risque de conflit

Aucun — détecteurs et diagnostics sont dans des dossiers séparés, pas de fichiers partagés à modifier.

## Pattern commun des détecteurs

```typescript
import { Detector, LayoutTree, Issue, IssueCategory } from "../types.js";

export class OverflowDetector implements Detector {
  category: IssueCategory = "overflow";
  detect(tree: LayoutTree): Issue[] { ... }
}
```
