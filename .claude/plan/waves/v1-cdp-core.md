# V1 — CDP Core

## Statut : EN COURS

## Tâches

- [ ] `src/cdp/connection.ts` — Classe CDPConnection (connect, disconnect, client persistent)
- [ ] `src/cdp/extractor.ts` — Classe LayoutExtractor (DOM traversal, box model, computed styles, CSS rules, scroll state, stacking contexts)

## Dépendances

Aucune — c'est la fondation.

## Fichiers touchés

- `src/cdp/connection.ts` (création)
- `src/cdp/extractor.ts` (création)
- `src/types.ts` (possible ajustement si types manquants)

## Critères de validation

- `npx tsc --noEmit` passe
- CDPConnection se connecte à Chrome lancé avec `--remote-debugging-port=9222`
- LayoutExtractor produit un LayoutTree complet depuis une page web

## Notes

- Le client CDP doit rester persistent (pas connect/disconnect par requête) — requis pour le monitoring futur
- Filtrer les éléments `display:none` tôt
- Gérer les erreurs par élément (un élément qui fail ne crashe pas l'arbre)
