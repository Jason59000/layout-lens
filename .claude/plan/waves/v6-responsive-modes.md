# V6 — Responsive + Modes spéciaux

## Statut : BROUILLON

## Sous-features

### 6a. Multi-viewport responsive testing — Complexité : MOYENNE

**Problème** : Layout qui casse à certaines tailles d'écran. Le dev test à 1280px, ça casse à 768px.

**Comment** :
- `Emulation.setDeviceMetricsOverride` pour simuler différents viewports
- Prendre un snapshot à chaque breakpoint
- Comparer les snapshots → détecter les éléments qui overflow/disparaissent/wrap seulement à certaines tailles

**Breakpoints standards** : 320 (mobile S), 375 (mobile), 768 (tablet), 1024 (laptop), 1280 (desktop), 1920 (wide)

**Travail nécessaire** :
- [ ] Boucle sur N viewports avec resize + re-extract
- [ ] Diff engine pour comparer LayoutTrees à différents viewports
- [ ] Détecter : overflow qui apparaît seulement à certaines tailles, éléments qui disparaissent, layout shifts au breakpoint

**Outil MCP** : `test_responsive(breakpoints?)`

**Format** :
```
RESPONSIVE ANALYSIS: 6 viewports tested

BREAKAGE AT 768px (tablet):
  1. nav.main-menu wraps to 2 lines (1 line at 1024px)
     menu items: 8, total width needed: 840px, available: 768px
  2. table.data overflows by 456px (no horizontal scroll)

BREAKAGE AT 320px (mobile):
  1. h1.hero-title font-size: 48px causes horizontal scroll
     text width: 412px, viewport: 320px
  2. div.two-column still side-by-side (should stack)
     media query @media (max-width: 640px) exists but doesn't cover 320px

ALL CLEAR: 1024px, 1280px, 1920px
```

---

### 6b. Dark mode comparison — Complexité : FAIBLE

**Problème** : Layout/visibilité qui casse en dark mode (texte invisible sur fond sombre, borders qui disparaissent, etc.)

**Comment** :
- `Emulation.setEmulatedMedia` avec `prefers-color-scheme: dark`
- Snapshot en light → snapshot en dark → comparer
- Détecter : contraste insuffisant, éléments qui deviennent invisibles, borders/shadows qui disparaissent

**Outil MCP** : `compare_color_scheme()`

---

### 6c. Print layout — Complexité : FAIBLE

**Problème** : Page qui s'imprime mal (éléments cachés, layout cassé en print).

**Comment** :
- `Emulation.setEmulatedMedia` avec `print`
- Snapshot → détecter les éléments qui overflow la largeur papier, les éléments cachés qui ne devraient pas l'être

---

### 6d. RTL (right-to-left) — Complexité : MOYENNE

**Problème** : Layout cassé pour les langues RTL (arabe, hébreu).

**Comment** :
- Injecter `dir="rtl"` sur le html
- Comparer le layout → détecter les éléments qui overflow, le texte mal aligné, les margins/paddings pas symétriques

---

## Estimation

| Feature | Complexité | Impact utilisateur |
|---------|-----------|-------------------|
| 6a Responsive | Moyenne | TRÈS HAUT — problème quotidien |
| 6b Dark mode | Faible | Moyen |
| 6c Print | Faible | Faible (niche) |
| 6d RTL | Moyenne | Moyen (marchés spécifiques) |
