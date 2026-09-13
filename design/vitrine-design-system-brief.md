# Vitrine — design system brief

You're helping build **Vitrine**, a productivity app. Use this system for anything visual you produce — UI, charts, mockups, marketing pages. It's a "dark Jazz Age" identity: Art Deco geometry, dark jewel tones, brass used sparingly. Dark mode is the default; light mode is a cream "playbill" variant.

Every value below is contrast-audited and the chart palette is validated for colourblind separation. Use these values as given rather than picking new ones.

## Rules

1. **Use the semantic tokens below, not raw hexes**, and never reach past them into a ramp.
2. **Sapphire is every action** — buttons, links, selected states, active tabs.
3. **Brass is punctuation, never a button fill.** Focus rings, the active nav item, a number worth noticing, the wordmark. Gold buttons look like a scam. Keep brass under ~5% of any screen.
4. **Deco is geometry, not ornament.** Stepped corners, hairline rules, wide letterspaced caps, symmetry. Small radii — 5px max, 0–3px on anything dense. No filigree, no scattered sunburst motifs, no drop shadows faking gilt.
5. **Status always carries an icon and a label**, never colour alone.
6. **Chart series are assigned in fixed slot order and never cycled or reshuffled.** There is no slot 7 — a seventh entity folds into "Other". Never a dual-axis chart.
7. **Focus is always the brass ring:** `outline: 2px solid var(--color-focus); outline-offset: 2px`. Never remove it.

## Tokens — paste this in

```css
:root {
  /* Dark is the default. */
  --color-bg: #09111D;
  --color-bg-surface: #121A25;
  --color-bg-raised: #1C232F;
  --color-bg-sunken: #020713;
  --color-bg-overlay: rgba(2, 7, 19, 0.72);
  --color-fg: #D0D8E4;
  --color-fg-secondary: #B2BBC9;
  --color-fg-muted: #9099A7;
  --color-fg-disabled: #707885;
  --color-fg-inverse: #020713;
  --color-accent: #E5B64A;
  --color-accent-quiet: #836202;
  --color-link: #9ABFFA;
  --color-line: #2C333E;
  --color-line-strong: #3F4550;
  --color-line-control: #707885;
  --color-focus: #E5B64A;
  --color-primary: #2062C7;
  --color-primary-hover: #2E70D6;
  --color-primary-active: #0C49A0;
  --color-on-primary: #FFFFFF;
  --color-success: #48DBA2;
  --color-success-bg: #022819;
  --color-success-line: #105D41;
  --color-warning: #FAA680;
  --color-warning-bg: #391301;
  --color-warning-line: #7F350C;
  --color-danger: #FAA0B0;
  --color-danger-bg: #410318;
  --color-danger-line: #8F133E;
  --color-danger-solid: #B42A54;
  --color-info: #9ABFFA;
  --color-info-bg: #011D4B;
  --color-info-line: #0C49A0;
  --color-series-1: #3C7FE5;
  --color-series-2: #22986D;
  --color-series-3: #836202;
  --color-series-4: #D3496E;
  --color-series-5: #9C5DD8;
  --color-series-6: #C06539;
  --color-seq-1: #0C49A0;
  --color-seq-2: #2062C7;
  --color-seq-3: #3C7FE5;
  --color-seq-4: #659EF8;
  --color-seq-5: #9ABFFA;
  --color-seq-6: #C5DBFC;
  --font-display: 'Josefin Sans', Futura, 'Century Gothic', sans-serif;
  --font-sans: 'Inter', -apple-system, 'Segoe UI', sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, Menlo, monospace;
  --radius-sm: 2px; --radius-md: 3px; --radius-lg: 5px;
  color-scheme: dark;
}
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    --color-bg: #F7F1E6;
    --color-bg-surface: #FDFAF3;
    --color-bg-raised: #FFFFFF;
    --color-bg-sunken: #EEE7D9;
    --color-bg-overlay: rgba(9, 17, 29, 0.48);
    --color-fg: #09111D;
    --color-fg-secondary: #2C333E;
    --color-fg-muted: #545B66;
    --color-fg-disabled: #707885;
    --color-fg-inverse: #FFFFFF;
    --color-accent: #634A0D;
    --color-accent-quiet: #C49726;
    --color-link: #0C49A0;
    --color-line: #B2BBC9;
    --color-line-strong: #9099A7;
    --color-line-control: #707885;
    --color-focus: #836202;
    --color-primary: #2062C7;
    --color-primary-hover: #0C49A0;
    --color-primary-active: #053274;
    --color-on-primary: #FFFFFF;
    --color-success: #105D41;
    --color-success-bg: #BEFEDE;
    --color-success-line: #2CB985;
    --color-warning: #7F350C;
    --color-warning-bg: #FEE8DE;
    --color-warning-line: #E08256;
    --color-danger: #8F133E;
    --color-danger-bg: #FEE6E9;
    --color-danger-line: #F5688A;
    --color-danger-solid: #8F133E;
    --color-info: #0C49A0;
    --color-info-bg: #E3EEFE;
    --color-info-line: #659EF8;
    --color-series-1: #3C7FE5;
    --color-series-2: #22986D;
    --color-series-3: #836202;
    --color-series-4: #D3496E;
    --color-series-5: #9C5DD8;
    --color-series-6: #C06539;
    --color-seq-1: #659EF8;
    --color-seq-2: #3C7FE5;
    --color-seq-3: #2062C7;
    --color-seq-4: #0C49A0;
    --color-seq-5: #053274;
    --color-seq-6: #011D4B;
    color-scheme: light;
  }
}
:root[data-theme="light"] {
  --color-bg: #F7F1E6;
  --color-bg-surface: #FDFAF3;
  --color-bg-raised: #FFFFFF;
  --color-bg-sunken: #EEE7D9;
  --color-bg-overlay: rgba(9, 17, 29, 0.48);
  --color-fg: #09111D;
  --color-fg-secondary: #2C333E;
  --color-fg-muted: #545B66;
  --color-fg-disabled: #707885;
  --color-fg-inverse: #FFFFFF;
  --color-accent: #634A0D;
  --color-accent-quiet: #C49726;
  --color-link: #0C49A0;
  --color-line: #B2BBC9;
  --color-line-strong: #9099A7;
  --color-line-control: #707885;
  --color-focus: #836202;
  --color-primary: #2062C7;
  --color-primary-hover: #0C49A0;
  --color-primary-active: #053274;
  --color-on-primary: #FFFFFF;
  --color-success: #105D41;
  --color-success-bg: #BEFEDE;
  --color-success-line: #2CB985;
  --color-warning: #7F350C;
  --color-warning-bg: #FEE8DE;
  --color-warning-line: #E08256;
  --color-danger: #8F133E;
  --color-danger-bg: #FEE6E9;
  --color-danger-line: #F5688A;
  --color-danger-solid: #8F133E;
  --color-info: #0C49A0;
  --color-info-bg: #E3EEFE;
  --color-info-line: #659EF8;
  --color-series-1: #3C7FE5;
  --color-series-2: #22986D;
  --color-series-3: #836202;
  --color-series-4: #D3496E;
  --color-series-5: #9C5DD8;
  --color-series-6: #C06539;
  --color-seq-1: #659EF8;
  --color-seq-2: #3C7FE5;
  --color-seq-3: #2062C7;
  --color-seq-4: #0C49A0;
  --color-seq-5: #053274;
  --color-seq-6: #011D4B;
  color-scheme: light;
}
:root[data-theme="dark"] {
  --color-bg: #09111D;
  --color-bg-surface: #121A25;
  --color-bg-raised: #1C232F;
  --color-bg-sunken: #020713;
  --color-bg-overlay: rgba(2, 7, 19, 0.72);
  --color-fg: #D0D8E4;
  --color-fg-secondary: #B2BBC9;
  --color-fg-muted: #9099A7;
  --color-fg-disabled: #707885;
  --color-fg-inverse: #020713;
  --color-accent: #E5B64A;
  --color-accent-quiet: #836202;
  --color-link: #9ABFFA;
  --color-line: #2C333E;
  --color-line-strong: #3F4550;
  --color-line-control: #707885;
  --color-focus: #E5B64A;
  --color-primary: #2062C7;
  --color-primary-hover: #2E70D6;
  --color-primary-active: #0C49A0;
  --color-on-primary: #FFFFFF;
  --color-success: #48DBA2;
  --color-success-bg: #022819;
  --color-success-line: #105D41;
  --color-warning: #FAA680;
  --color-warning-bg: #391301;
  --color-warning-line: #7F350C;
  --color-danger: #FAA0B0;
  --color-danger-bg: #410318;
  --color-danger-line: #8F133E;
  --color-danger-solid: #B42A54;
  --color-info: #9ABFFA;
  --color-info-bg: #011D4B;
  --color-info-line: #0C49A0;
  --color-series-1: #3C7FE5;
  --color-series-2: #22986D;
  --color-series-3: #836202;
  --color-series-4: #D3496E;
  --color-series-5: #9C5DD8;
  --color-series-6: #C06539;
  --color-seq-1: #0C49A0;
  --color-seq-2: #2062C7;
  --color-seq-3: #3C7FE5;
  --color-seq-4: #659EF8;
  --color-seq-5: #9ABFFA;
  --color-seq-6: #C5DBFC;
  color-scheme: dark;
}
```

## Typography

Load: `https://fonts.googleapis.com/css2?family=Josefin+Sans:wght@200;300;400&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap`

- **Josefin Sans** (weights 200–400 only) — wordmark, hero lines, marketing headlines, letterspaced caps. **Never below 20px, never inside product UI.**
- **Inter** — all product UI, tables, forms, body. Default size **14px** (this is a dense productivity tool).
- **IBM Plex Mono** — IDs, hex values, timestamps, code, columns of digits.

Scale (1.22 ratio): 11 · 12 · 13 · **14** · 16 · 18 · 21 · 25 · 31 · 39 · 49 · 61 px.
Tracking: display `-0.022em`, caps labels `0.14em`, wordmark `0.20em` (nowhere else).

## Chart colour

Fixed slot order, identical in both modes:

1. `#3C7FE5` — sapphire
2. `#22986D` — emerald
3. `#836202` — brass
4. `#D3496E` — garnet
5. `#9C5DD8` — amethyst
6. `#C06539` — copper

- **Sequential (magnitude):** one hue, sapphire — light mode `#659EF8 → #3C7FE5 → #2062C7 → #0C49A0 → #053274 → #011D4B`; dark mode reversed.
- **Diverging (polarity):** garnet ↔ neutral `#9099A7` ↔ emerald. Never a jewel hue at the midpoint.
- Status colours (`--color-success` etc.) are reserved and never reused as a series.

## The wordmark and mark

The wordmark is **VITRINE** in Josefin Sans 300, uppercase, `0.20em` letter-spacing, in brass — `#E5B64A` on dark, `#634A0D` on cream.

The primary mark is **The Case**: a stepped Art Deco display cabinet on a plinth, brass frame, dark glass pane inside, with a V cut into the glass as the raking light. Minimum size 16px; clearspace equals the plinth height. If you need the SVG, ask — it's a separate file.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Vitrine mark">
  <defs>
    <linearGradient id="b" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FCD37D"/><stop offset="55%" stop-color="#C49726"/>
      <stop offset="100%" stop-color="#836202"/></linearGradient>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#053274"/><stop offset="100%" stop-color="#020713"/></linearGradient>
  </defs>
  <path d="M8,54 L8,26 L16,26 L16,17 L24,17 L24,8 L40,8 L40,17 L48,17 L48,26 L56,26 L56,54 Z" fill="url(#b)"/>
  <path d="M14,54 L14,30 L21,30 L21,22 L28,22 L28,14 L36,14 L36,22 L43,22 L43,30 L50,30 L50,54 Z" fill="url(#g)"/>
  <path d="M23,29 L32,47 L41,29" fill="none" stroke="url(#b)" stroke-width="4.2"/>
  <rect x="4" y="54" width="56" height="6" fill="url(#b)"/>
</svg>
```

## Accessibility contract

- Text ≥ 4.5:1 on its surface; large display text ≥ 3:1.
- `--color-line-control` (input/control borders) ≥ 3:1 — it identifies a control. `--color-line` is decorative and exempt.
- `--color-fg-disabled` is deliberately ~4:1 and exempt under WCAG 1.4.3. Don't "fix" it.
- Define colours as tokens only — never inside a media query or `[data-theme]` block, or they'll fail in the unstamped theme state.
- Respect `prefers-reduced-motion`.

---
*One unconfirmed assumption: this brief treats Vitrine as a tool for presenting and curating work. The colour, type and token systems don't depend on that, but tone of voice does.*
