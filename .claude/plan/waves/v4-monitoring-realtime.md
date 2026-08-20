# V4 — Monitoring temps réel

## Statut : BROUILLON

## Pourquoi

Les 10 détecteurs de V2 travaillent sur un **snapshot** — une photo à un instant T. Mais certains bugs n'existent que dans le temps : un élément qui saute au chargement, une animation qui freeze, un composant qui re-render 60 fois/seconde.

## Approche : 2 modes, pas de start/stop

**Mode 1 — Post-load auto** : un appel après chargement, récupère CLS + animations + images sans dimensions. Quasi-gratuit, pas de monitoring continu.
→ Outil MCP : `check_after_load()`

**Mode 2 — Monitoring durée fixe** : le LLM dit "observe 5 secondes". Snapshot before, écoute mutations, snapshot after, diff + résumé.
→ Outil MCP : `monitor(duration_ms)`

**Pas de start/stop** : le LLM ne peut pas interagir avec la page lui-même. Un mode enregistrement interactif viendrait plus tard, couplé à des outils CDP d'interaction (click, scroll).

**Format clé** : le LLM reçoit un **résumé diagnostic**, pas un log d'événements bruts. Métriques agrégées (mutations/sec), hotspots, diff before/after.

---

## Sous-features

### 4a. Layout Shift (CLS) — Complexité : FAIBLE — Mode 1

**Problème** : Éléments qui bougent après le render initial (image sans dimensions, font qui charge, contenu injecté).

**Source CDP** : `Runtime.evaluate` → `performance.getEntriesByType('layout-shift')`
- Retourne directement quels éléments ont bougé, de combien, et quand
- Pas besoin de monitoring continu — un seul appel après chargement suffit
- C'est presque un snapshot décalé dans le temps

**Travail nécessaire** :
- [ ] Ajouter un appel post-page-load dans l'extractor (ou un outil MCP dédié)
- [ ] Parser les LayoutShift entries → identifier les éléments sources
- [ ] Croiser avec le LayoutTree pour donner le diagnostic (quelle image, quel élément dynamique)

**Outil MCP** : `detect_layout_shifts()` ou intégré dans `find_issues("layout-shift")`

**Format de sortie** :
```
ISSUE: layout shift detected (CLS: 0.15)
ELEMENT: img.hero-banner
  shifted: 32px downward at t=1.2s
CAUSE: image loaded without explicit width/height
  natural: 1920×1080, container: 100% width
  → height was 0px before load, 540px after
ROOT CAUSE: missing width/height attributes on <img>
```

---

### 4b. Stuck Animation / Transition bloquée — Complexité : FAIBLE

**Problème** : Animation CSS qui ne démarre pas, qui freeze, ou transition qui ne se déclenche jamais.

**Source CDP** : domaine `Animation`
- `Animation.enable()` → écoute `animationStarted`, `animationCanceled`
- `Animation.getCurrentTime()` → progression actuelle
- Snapshot suffit : "cette animation est à 0% depuis 3s = bloquée"

**Travail nécessaire** :
- [ ] Activer le domaine Animation dans la connection CDP
- [ ] Lister toutes les animations actives et leur état
- [ ] Détecter : animation à 0% depuis > Xs, animation canceled, transition sur propriété non-animable

**Outil MCP** : intégré dans `find_issues("animation")`

**Format de sortie** :
```
ISSUE: animation stuck at 0%
ELEMENT: div.loading-spinner
  animation: spin 1s linear infinite
  current time: 0ms (started 3.2s ago)
CAUSE CHAIN:
  1. div.loading-spinner has animation: spin 1s linear infinite
  2. element has display: none
     → from: .hidden { display: none }  (utils.css:12)
  3. animations don't run on display:none elements
ROOT CAUSE: element hidden while animation declared
```

---

### 4c. Hover/Focus States — Complexité : MOYENNE

**Problème** : Bouton sans feedback au hover, focus invisible, états interactifs cassés.

**Source CDP** : `CSS.forcePseudoState(nodeId, ['hover'])` (CDP le supporte nativement !)
- Force un pseudo-état sans interaction réelle
- Puis re-snapshot des computed styles
- Compare état normal vs état hover/focus

**Travail nécessaire** :
- [ ] Identifier tous les éléments interactifs (buttons, links, inputs, [role="button"])
- [ ] Pour chacun, forcer :hover puis comparer les computed styles
- [ ] Pour chacun, forcer :focus puis vérifier si un outline/ring/shadow apparaît
- [ ] Détecter : aucun changement visuel au hover = UX problem, outline:none sans remplacement = accessibility bug

**Outil MCP** : `check_interactive_states()` ou intégré dans `find_issues("interaction")`

**Format de sortie** :
```
ISSUE: no visual feedback on hover
ELEMENT: button.submit-btn
  normal state: background #3b82f6, no shadow
  hover state: IDENTICAL (no style change)
CAUSE: no :hover rule defined for this element
  checked selectors: .submit-btn:hover, button:hover — none match

ISSUE: focus outline removed without replacement
ELEMENT: input.search-field
  has: outline: none (from: .search-field { outline: none } form.css:34)
  missing: no box-shadow, border-change, or ring on :focus
ROOT CAUSE: outline:none without accessible focus indicator
  → accessibility violation (WCAG 2.4.7)
```

---

### 4d. DOM Thrashing / Re-renders excessifs — Complexité : HAUTE

**Problème** : Composant React/Vue qui re-render en boucle, JS qui force des reflows répétés.

**Source CDP** : 
- `DOM.childNodeInserted`, `DOM.childNodeRemoved`, `DOM.attributeModified` → events continus
- Compter les mutations par seconde, identifier les éléments qui changent trop souvent
- Pour React spécifiquement : React DevTools protocol (séparé de CDP)

**Travail nécessaire** :
- [ ] `src/cdp/monitor.ts` — nouvelle classe CDPMonitor qui écoute les événements DOM
- [ ] Session de monitoring (durée configurable, ex: 5 secondes)
- [ ] Compteur de mutations par élément par seconde
- [ ] Seuil configurable (ex: >10 mutations/sec = warning, >60 = error)
- [ ] Heuristique pour distinguer animation légitime vs re-render loop

**Outil MCP** : `watch_dom_mutations(duration_ms?)` 

**Format de sortie** :
```
MONITORING: 5s DOM mutation capture

HOT ELEMENTS (>10 mutations/sec):
1. div.price-display — 62 mutations/sec (attribute: textContent)
   in: body → main → .product-card → .price-display
   pattern: continuous update (likely re-render loop)
   
2. ul.notification-list — 15 mutations/sec (childNode insert/remove)
   in: body → aside → .notification-panel → ul
   pattern: list items being added/removed rapidly

TOTAL: 385 DOM mutations in 5s (77/sec average)
```

**Note** : C'est la seule feature qui nécessite un vrai changement d'architecture (CDPMonitor class, event listeners, session concept).

---

### 4e. Animation Jank (FPS drops) — Complexité : HAUTE

**Problème** : Animation qui saccade, scrolling pas fluide, transitions qui "sautent".

**Source CDP** :
- `Tracing.start` avec catégories rendering → frame timing
- OU `Runtime.evaluate` avec `requestAnimationFrame` loop mesurant les frame times
- OU `Performance.getMetrics()` pour les métriques haut niveau

**Travail nécessaire** :
- [ ] Session de capture performance (durée configurable)
- [ ] Analyser les frame timings : frames > 16.67ms (60fps) = jank
- [ ] Identifier les éléments qui causent du layout thrashing (lecture/écriture DOM alternée)
- [ ] Possiblement utiliser `Performance.enable()` + Chrome trace events

**Outil MCP** : `profile_rendering(duration_ms?)`

**Format de sortie** :
```
RENDERING PROFILE: 3s capture

FPS: avg 42fps (target: 60fps)
JANK FRAMES: 28/180 (15.5%)
LONGEST FRAME: 89ms (at t=1.4s)

LAYOUT THRASHING DETECTED:
  script at app.js:234 triggers forced reflow
  pattern: read offsetHeight → write style.height → read offsetHeight (loop)
  affected elements: 12 items in .product-grid
  
HEAVY PAINT:
  div.animated-bg — repaint on every frame (will-change: transform missing)
```

---

## Architecture nécessaire

### Ce qui existe déjà (V1) et suffit pour 4a, 4b, 4c
- `CDPConnection` avec client persistent ✓
- Domaines DOM, CSS, Runtime activés ✓
- Il faut juste activer `Animation` en plus

### Ce qu'il faut ajouter pour 4d, 4e
```
src/cdp/
├── connection.ts    # existant — ajouter Animation.enable()
├── extractor.ts     # existant
└── monitor.ts       # NOUVEAU — event stream + sessions

src/detectors/
├── ... (existants)
├── layout-shift.ts      # 4a — quasi-snapshot
├── stuck-animation.ts   # 4b — quasi-snapshot  
├── interactive-states.ts # 4c — snapshot avec simulation
├── dom-mutations.ts     # 4d — monitoring
└── render-perf.ts       # 4e — monitoring
```

### Types à ajouter
```typescript
interface MonitorSession {
  startTime: number;
  duration: number;
  events: DOMEvent[];
}

interface DOMEvent {
  type: "insert" | "remove" | "attribute";
  nodeId: number;
  timestamp: number;
  detail?: string;
}

interface FrameMetrics {
  timestamp: number;
  duration: number;
  isJank: boolean;
}
```

---

## Estimation par feature

| Feature | Complexité | Dépend de | Peut être fait en parallèle |
|---------|-----------|-----------|---------------------------|
| 4a Layout shift | Faible | V1 seulement | Oui |
| 4b Stuck animation | Faible | V1 seulement | Oui |
| 4c Hover/focus | Moyenne | V1 + V2 (visibility detector) | Après V2 |
| 4d DOM thrashing | Haute | V1 + monitor.ts | Non (nouveau composant) |
| 4e Animation jank | Haute | V1 + monitor.ts | Avec 4d (même base) |

**Recommandation** : Faire 4a+4b immédiatement après V3 (quasi-gratuit). 4c après. 4d+4e ensemble dans une vague dédiée car elles partagent le CDPMonitor.
