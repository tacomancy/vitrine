# Vitrine — brand & design system

Machine-readable spec for agents working on Vitrine. **Read this before writing any UI, chart, or marketing surface.**
Everything here is generated and contrast-audited; if a value in code disagrees with this file, this file wins.

Files in this folder:

| File | Use |
|---|---|
| `tokens.css` | **Canonical.** Import once, globally. Defines every token plus all three theme states. |
| `tailwind.css` | Tailwind v4 `@theme` projection of the same tokens. Use *instead of* tokens.css if the project is Tailwind. |
| `tokens.json` | W3C-style token file for Style Dictionary, Figma sync, or programmatic reads. |
| `assets/*.svg` | Marks and lockup, standalone and self-contained. |

## Setup

```css
/* plain CSS */
@import "./tokens.css";
```
```css
/* Tailwind v4 — replaces your @import "tailwindcss" line */
@import "./tailwind.css";
```

Theming is already wired for all three viewer states: bare `:root` is dark, `@media (prefers-color-scheme: light)` guarded by `:root:not([data-theme="dark"])` handles system-light, and `[data-theme]` on `<html>` lets an explicit toggle win in both directions. **Do not add colours inside a media query or `[data-theme]` block** — define them as tokens or they will fail in the unstamped state.

## The eight laws

1. **Components read semantic tokens, never ramp steps.** `var(--color-primary)`, not `var(--color-sapphire-600)`. The ramps are raw material; the semantic layer is the API.
2. **Sapphire is every action.** Buttons, links, selected states, checked boxes, active tabs.
3. **Brass is punctuation, never a button.** Focus rings, the active nav item, a number worth noticing, the wordmark. If more than ~5% of a screen is brass, cut it back.
4. **Dark is the default mode.** The bare `:root` block is dark; light is the override. Don't invert this.
5. **Deco is geometry, not ornament.** Stepped corners, hairline rules, wide letterspaced caps, symmetry. Radii stay small — max `5px`, and `0–3px` on anything dense. No filigree, no sunburst motifs sprinkled as decoration, no fake gilding via drop shadow.
6. **Status always ships with an icon and a label.** Colour alone never carries state.
7. **Chart series are assigned in slot order and never cycled.** A filter that removes series 3 must not repaint the others. There is no slot 7 — a seventh entity folds into "Other" or the chart becomes small multiples.
8. **Never a dual-axis chart.** Two measures of different scale means two charts.

## Semantic tokens

**Surfaces**

| Token | Dark (default) | Light |
|---|---|---|
| `--color-bg` | `#09111D` | `#F7F1E6` |
| `--color-bg-surface` | `#121A25` | `#FDFAF3` |
| `--color-bg-raised` | `#1C232F` | `#FFFFFF` |
| `--color-bg-sunken` | `#020713` | `#EEE7D9` |
| `--color-bg-overlay` | `rgba(2, 7, 19, 0.72)` | `rgba(9, 17, 29, 0.48)` |

**Content**

| Token | Dark (default) | Light |
|---|---|---|
| `--color-fg` | `#D0D8E4` | `#09111D` |
| `--color-fg-secondary` | `#B2BBC9` | `#2C333E` |
| `--color-fg-muted` | `#9099A7` | `#545B66` |
| `--color-fg-disabled` | `#707885` | `#707885` |
| `--color-fg-inverse` | `#020713` | `#FFFFFF` |
| `--color-accent` | `#E5B64A` | `#634A0D` |
| `--color-accent-quiet` | `#836202` | `#C49726` |
| `--color-link` | `#9ABFFA` | `#0C49A0` |

**Lines & focus**

| Token | Dark (default) | Light |
|---|---|---|
| `--color-line` | `#2C333E` | `#B2BBC9` |
| `--color-line-strong` | `#3F4550` | `#9099A7` |
| `--color-line-control` | `#707885` | `#707885` |
| `--color-focus` | `#E5B64A` | `#836202` |

**Primary action**

| Token | Dark (default) | Light |
|---|---|---|
| `--color-primary` | `#2062C7` | `#2062C7` |
| `--color-primary-hover` | `#2E70D6` | `#0C49A0` |
| `--color-primary-active` | `#0C49A0` | `#053274` |
| `--color-on-primary` | `#FFFFFF` | `#FFFFFF` |

**Status**

| Token | Dark (default) | Light |
|---|---|---|
| `--color-success` | `#48DBA2` | `#105D41` |
| `--color-success-bg` | `#022819` | `#BEFEDE` |
| `--color-success-line` | `#105D41` | `#2CB985` |
| `--color-warning` | `#FAA680` | `#7F350C` |
| `--color-warning-bg` | `#391301` | `#FEE8DE` |
| `--color-warning-line` | `#7F350C` | `#E08256` |
| `--color-danger` | `#FAA0B0` | `#8F133E` |
| `--color-danger-bg` | `#410318` | `#FEE6E9` |
| `--color-danger-line` | `#8F133E` | `#F5688A` |
| `--color-danger-solid` | `#B42A54` | `#8F133E` |
| `--color-info` | `#9ABFFA` | `#0C49A0` |
| `--color-info-bg` | `#011D4B` | `#E3EEFE` |
| `--color-info-line` | `#0C49A0` | `#659EF8` |

**Chart series (fixed order, never cycled)**

| Token | Dark (default) | Light |
|---|---|---|
| `--color-series-1` | `#3C7FE5` | `#3C7FE5` |
| `--color-series-2` | `#22986D` | `#22986D` |
| `--color-series-3` | `#836202` | `#836202` |
| `--color-series-4` | `#D3496E` | `#D3496E` |
| `--color-series-5` | `#9C5DD8` | `#9C5DD8` |
| `--color-series-6` | `#C06539` | `#C06539` |

**Sequential (magnitude)**

| Token | Dark (default) | Light |
|---|---|---|
| `--color-seq-1` | `#0C49A0` | `#659EF8` |
| `--color-seq-2` | `#2062C7` | `#3C7FE5` |
| `--color-seq-3` | `#3C7FE5` | `#2062C7` |
| `--color-seq-4` | `#659EF8` | `#0C49A0` |
| `--color-seq-5` | `#9ABFFA` | `#053274` |
| `--color-seq-6` | `#C5DBFC` | `#011D4B` |

## Ramps

Generated in OKLCH at fixed perceptual lightness, so the same step number is equally light across families. Reference these only when defining a new semantic token.

- **sapphire** _(primary / interactive)_ — `100` #E3EEFE · `200` #C5DBFC · `300` #9ABFFA · `400` #659EF8 · `500` #3C7FE5 · `550` #2E70D6 · `600` #2062C7 · `700` #0C49A0 · `800` #053274 · `900` #011D4B
- **teal** _(decorative only — cannot hold a chart slot)_ — `100` #C1F9FE · `200` #67F0FC · `300` #37D5E1 · `400` #2CB2BD · `500` #02939D · `550` #01848D · `600` #00767E · `700` #10595F · `800` #083F43 · `900` #022629
- **emerald** _(success, positive delta)_ — `100` #BEFEDE · `200` #6AF8BC · `300` #48DBA2 · `400` #2CB985 · `500` #22986D · `550` #1E8861 · `600` #157A56 · `700` #105D41 · `800` #08412C · `900` #022819
- **brass** _(accent, focus, wordmark)_ — `100` #FEEBC4 · `200` #FCD37D · `300` #E5B64A · `400` #C49726 · `500` #A17B1D · `550` #916F19 · `600` #836202 · `700` #634A0D · `800` #463406 · `900` #2B1E01
- **copper** _(warning, second metal)_ — `100` #FEE8DE · `200` #FCCDB9 · `300` #FAA680 · `400` #E08256 · `500` #C06539 · `550` #B1582B · `600` #A24A1C · `700` #7F350C · `800` #5B2405 · `900` #391301
- **garnet** _(danger)_ — `100` #FEE6E9 · `200` #FCCAD2 · `300` #FAA0B0 · `400` #F5688A · `500` #D3496E · `550` #C33A61 · `600` #B42A54 · `700` #8F133E · `800` #67092A · `900` #410318
- **amethyst** _(chart identity only)_ — `100` #F1E8FE · `200` #E3CFFC · `300` #CFAAFA · `400` #B97CF8 · `500` #9C5DD8 · `550` #8E4FC9 · `600` #8141BA · `700` #67229D · `800` #4B0C77 · `900` #2E044D
- **ink** _(all neutrals, surfaces and lines)_ — `50` #EAEFF5 · `100` #D0D8E4 · `200` #B2BBC9 · `300` #9099A7 · `400` #707885 · `500` #545B66 · `600` #3F4550 · `700` #2C333E · `800` #1C232F · `850` #121A25 · `900` #09111D · `950` #020713
- **paper** _(light-mode grounds)_ — `base` #F7F1E6 · `raised` #FDFAF3 · `sunken` #EEE7D9

## Typography

| Role | Family | Weights | Where |
|---|---|---|---|
| Display | Josefin Sans | 200–400 only | Wordmark, hero lines, marketing headlines, letterspaced caps. **Never below 20px. Never inside product UI.** |
| Interface | Inter | 400/500/600/700 | All product UI, tables, forms, body copy. Default size 14px. |
| Data | IBM Plex Mono | 400/500 | IDs, hex values, timestamps, code, any column of digits. |

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Josefin+Sans:wght@200;300;400&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
```

Scale (1.22 ratio, whole pixels): `2xs` 11 · `xs` 12 · `sm` 13 · **`base` 14** · `md` 16 · `lg` 18 · `xl` 21 · `2xl` 25 · `3xl` 31 · `4xl` 39 · `5xl` 49 · `6xl` 61

Tracking: display `-0.022em` · tight `-0.011em` · caps labels `0.14em` · **wordmark `0.20em` (used nowhere else)**

## Chart & data colour

Fixed slot order — **sapphire → emerald → brass → garnet → amethyst → copper**. Identical hexes in both modes, so a screenshot survives a theme switch.

1. **sapphire-500** `#3C7FE5`
2. **emerald-500** `#22986D`
3. **brass-600** `#836202`
4. **garnet-500** `#D3496E`
5. **amethyst-500** `#9C5DD8`
6. **copper-500** `#C06539`

- **Sequential (magnitude):** one hue, sapphire. Light mode `400→900`; dark mode `700→200`. Never a rainbow.
- **Diverging (polarity):** garnet ↔ **ink-300 neutral midpoint** ↔ emerald. Never a jewel hue at the midpoint.
- **Status vs. series:** series live on the 500/600 steps, status on 300 (dark) / 700 (light). Same families, never the same step.
- **Verified:** worst adjacent-pair separation ΔE 11.4 under simulated protanopia and deuteranopia (target 8), normal-vision floor 16.8 (floor 15), every slot ≥3:1 against its ground, in both modes.

## Marks

| File | Name | Use |
|---|---|---|
| `assets/mark-case.svg` | **The Case** — *recommended* | Primary mark. A stepped Deco cabinet on a plinth, lit glass inside, the V cut as the light. |
| `assets/mark-rake.svg` | The Rake | Alternate. Three nested chevrons under a hairline. |
| `assets/mark-facet.svg` | The Facet | Alternate. Beveled octagonal pane. |
| `assets/mark-case-mono-*.svg` | One-colour | Foil, embossing, single-colour print, favicons. |
| `assets/lockup-horizontal.svg` | Horizontal lockup | App header. Convert text to outlines before sending anywhere Josefin Sans isn't installed. |

- Clearspace on all sides = the plinth height (1/10 of the mark).
- Minimum mark size **16px**. Minimum horizontal lockup width **104px** — below that, mark only.
- Wordmark is **Josefin Sans 300, uppercase, 0.20em tracking**. Always.
- **Don't** recolour the glass pane (ink or sapphire-800 only), add a second gradient sheen, set the wordmark in Inter, or place the mark on a busy photo without a solid ink plate.

## Accessibility contract

Non-negotiable, and already true of every token pairing above:

- Body and UI text ≥ 4.5:1 against its own surface; large display text ≥ 3:1.
- `--color-line-control` (input and control borders) ≥ 3:1 — it identifies a control, so it is not decorative. `--color-line` **is** decorative and is exempt.
- `--color-fg-disabled` is deliberately ~4:1 and exempt under WCAG 1.4.3. Do not "fix" it.
- Focus is always the brass ring: `outline: 2px solid var(--color-focus); outline-offset: 2px`. Never remove it without an equivalent replacement.
- Respect `prefers-reduced-motion`.

## Voice

Plain, specific, unhurried. Controls say exactly what they do ("Publish", then "Published"). Errors state what broke and how to fix it — no apologies. Avoid exhibition-world preciousness; the Deco lives in the visuals, not the copy.

> **Unconfirmed:** this brief assumes Vitrine is a tool for presenting and curating work. Colour, type and tokens don't depend on that; the voice section does. Confirm before writing marketing copy.
