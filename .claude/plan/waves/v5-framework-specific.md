# V5 — Features spécifiques aux frameworks

## Statut : BROUILLON

## Pourquoi

Layout Lens est framework-agnostic par design (CDP voit le DOM final). Mais certains problèmes sont **causés** par le framework et le diagnostic serait incomplet sans cette info. Ces features sont optionnelles — elles enrichissent les diagnostics quand le framework est détecté.

---

## Sous-features

### 5a. Détection automatique du framework — Complexité : FAIBLE

**Comment** : `Runtime.evaluate` pour détecter les globals/marqueurs :
- React : `window.__REACT_DEVTOOLS_GLOBAL_HOOK__`, `_reactRootContainer` sur le root
- Vue : `window.__VUE__`, `__vue__` sur les éléments
- Svelte : `__svelte_meta` sur les composants
- Angular : `window.ng`, `ng-version` attribute
- Next.js : `window.__NEXT_DATA__`
- Nuxt : `window.__NUXT__`

**Sortie** : enrichit le header de `inspect_layout()` :
```
PAGE LAYOUT OVERVIEW
viewport: 1280×720
framework: React 18.2.0 (Next.js 14.1)
render mode: client-side (hydrated)
```

---

### 5b. React — Composant tree mapping — Complexité : MOYENNE

**Problème** : Le LLM voit `<div class="css-1a2b3c">` mais ne sait pas que c'est un `<ProductCard>`.

**Source** : React DevTools protocol (via `__REACT_DEVTOOLS_GLOBAL_HOOK__`)
- Mapper chaque DOM node à son composant React
- Récupérer le nom du composant, ses props, son state

**Travail nécessaire** :
- [ ] Hook dans React DevTools global
- [ ] Mapper nodeId CDP → fiber React
- [ ] Enrichir le LayoutNode avec `component?: { name, props }`

**Format enrichi** :
```
ELEMENT: div.css-1a2b3c
  component: <ProductCard> (src/components/ProductCard.tsx:12)
  props: { title: "...", price: 29.99, inStock: true }
  in: <App> → <ProductList> → <ProductCard>
```

---

### 5c. React — Re-render profiling — Complexité : HAUTE

**Problème** : Composant qui re-render trop souvent (cause de layout shift, jank, etc.)

**Source** : React Profiler API ou DevTools hook
- Nombre de renders par composant
- Raison du re-render (props changed, state changed, parent re-rendered)
- Durée de chaque render

**Travail nécessaire** :
- [ ] Injecter un profiler wrapper via `Runtime.evaluate`
- [ ] Capturer les renders sur une période
- [ ] Identifier les composants "chauds"

**Format** :
```
REACT RENDER PROFILE: 5s capture

HOT COMPONENTS (>5 renders/sec):
1. <PriceDisplay> — 62 renders/sec
   reason: parent <ProductCard> re-renders on price WebSocket update
   suggestion: memo() or useMemo on price prop
   
2. <NotificationBadge> — 15 renders/sec
   reason: context update (NotificationContext changes on every message)
   suggestion: split context or use useSyncExternalStore
```

---

### 5d. Vue — Reactivity tracking — Complexité : HAUTE

**Problème** : Watcher Vue qui fire en cascade, computed qui recalcule inutilement.

**Source** : `__VUE__` devtools hook
- Tracker les watchers/computed qui fire
- Identifier les cascades réactives

---

### 5e. Shadow DOM — Complexité : MOYENNE

**Problème** : Web Components avec Shadow DOM — les styles sont encapsulés, le layout peut être affecté par le shadow boundary.

**Source CDP** : CDP peut percer le Shadow DOM (`DOM.getDocument` avec `pierce: true`)
- Les éléments dans un shadow root ont des styles isolés
- Les slots (light DOM projeté) peuvent avoir des bugs de layout spécifiques

**Travail nécessaire** :
- [ ] Activer `pierce: true` dans l'extraction
- [ ] Marquer les shadow boundaries dans le LayoutTree
- [ ] Détecter les conflits de style shadow/light DOM

---

### 5f. Tailwind CSS — Diagnostic enrichi — Complexité : FAIBLE

**Problème** : Le LLM voit `class="flex items-center gap-4 p-6 overflow-hidden"` mais le diagnostic pointe vers une propriété computed. Faire le lien.

**Comment** : 
- Détecter Tailwind (présence de classes utilitaires connues)
- Mapper les computed styles problématiques aux classes Tailwind correspondantes
- Le diagnostic dit "change `overflow-hidden` en `overflow-auto`" au lieu de "change `overflow: hidden`"

**Format enrichi** :
```
ROOT CAUSE: overflow-x: hidden prevents scrolling
  tailwind class: overflow-hidden → suggest: overflow-x-auto
  element: <div class="flex items-center gap-4 overflow-hidden">
```

---

## Estimation globale

| Feature | Complexité | Dépend de | Framework |
|---------|-----------|-----------|-----------|
| 5a Détection framework | Faible | V1 | Tous |
| 5b React component mapping | Moyenne | V1 + 5a | React |
| 5c React re-render profiling | Haute | V1 + 5a + monitor.ts | React |
| 5d Vue reactivity | Haute | V1 + 5a + monitor.ts | Vue |
| 5e Shadow DOM | Moyenne | V1 | Web Components |
| 5f Tailwind diagnostic | Faible | V2 (detectors) | Tailwind |

**Recommandation** : 5a (détection) + 5f (Tailwind) sont quasi-gratuits. 5b (React component mapping) a un gros impact UX pour un coût modéré. Le reste est du "nice to have".
