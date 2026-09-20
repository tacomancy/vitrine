# Research #134 — a charting library for the dashboards

Resolves wayfinder research ticket [#134](https://github.com/tacomancy/vitrine/issues/134) (part of #131). Written 2026-09-20 against the libraries' own docs, source, and package metadata. Bundle figures are bundlephobia's measurement of the published tarball, taken the same day — a measurement, not a claim by the library.

## What the charts have to be

From `design-brief.md` § Dashboards and the pinned prototypes `10-scout-activity.png`, `11-question-map.png` (09 Loose Ends is lists only, no chart):

| Chart | Where | Shape it must take |
| --- | --- | --- |
| Coverage matrix | Question Map panel 1 | Questions × tags, both axes sorted by total weight, small square cells with gutters, monospace rotated column labels, per-cell click-through. Intensity is **binned, not continuous** — the prototype legend reads `none · 1 · 2–3 · 4–7 · 8+`. Brief caps it: "falls back to ranked lists past roughly 40 questions", so ~40 × ~40 = ~1,600 cells at most, the ticket's 60 × 40 = 2,400 the outside case. |
| Attention scatter | Question Map panel 2 | Sized filled circles labelled by tag, four quadrant labels, one accent colour for the blind-spot quadrant, a depth control, and an **unplaced band** below the plot that is not a zero row ("Unplaced is not low"). |
| Accept-rate line | Scout Activity | A sparkline per row and one expanded line chart with two y gridlines, one series, accent-coloured. |
| Funnel bars, ranked lists | Question Map panels 3–4, Scout Activity, Loose Ends | Horizontal bars with labels; ordinary HTML. |

Constraints on any option:

- **BRAND.md law 1** — components read semantic tokens (`--color-seq-1..6`, `--color-series-1..6`, `--color-accent`, `--color-fg-muted`, `--color-line`), never ramp steps. `docs/architecture.md` § Styling makes this a lint rule (`tooling/eslint-plugin-brand`) on CSS and on TS/TSX string literals.
- **Three theme states** — `tokens.css` redefines every semantic token under bare `:root` (dark), `prefers-color-scheme: light`, and `[data-theme]`. A chart whose colours are resolved to hex in JavaScript has to re-read them on every theme change; a chart whose fills are `var(--color-seq-3)` gets all three states for free from the cascade.
- **Law 7** — series colours in slot order, never cycled; six slots. Law 8 — no dual axis.
- **Brief § Visual caution** — no force-directed graph. None of the candidates is being asked to draw one; this rules a category of library feature out of scope, not a library.
- Every element clicks through to an object, so each cell / point / bar needs to be an addressable, focusable element — which favours a DOM (SVG) over a bitmap (canvas).

## The pivotal fact: what each library does with a `var(--…)` colour string

This is the whole comparison in one row each, because law 1 plus three theme states makes "does the fill reach the DOM untouched" the deciding question.

| Option | Fill reaches the DOM untouched? | Source |
| --- | --- | --- |
| **Hand SVG + d3-scale** | Yes — we write `fill={scale(v)}` ourselves. `scaleThreshold` / `scaleQuantize` return range elements verbatim: "The elements in the given array need not be numbers; any value or type will work." | [d3-scale quantize](https://github.com/d3/d3/blob/main/docs/d3-scale/quantize.md), [threshold](https://github.com/d3/d3/blob/main/docs/d3-scale/threshold.md) |
| **Visx** | Yes. `HeatmapRect` computes `color: colorScale(countValue)` and emits `fill={bin.color}`; no d3-color parsing. Every visx primitive is a React SVG element taking ordinary props, so `fill="var(--color-seq-3)"` is just JSX. | [visx-heatmap/HeatmapRect.tsx](https://github.com/airbnb/visx/blob/master/packages/visx-heatmap/src/heatmaps/HeatmapRect.tsx) |
| **Observable Plot** | Yes for constant fills — `isColor()` explicitly matches `var(...)`: `/^(?:url\|var\|rgb\|…)\(.*\)$/` "<funciri>, CSS variable, color, etc." A string that passes `isColor` "is interpreted as a constant" and "the values are interpreted literally and unscaled". **No** for interpolated colour scales: a continuous *color* scale interpolates between range values through d3-interpolate, which cannot interpolate `var()` strings. The binned matrix would have to use a `threshold` scale with an explicit 5-element `range` of tokens (untested — flagged for the spike). Plot also draws its continuous-legend `ramp` on a canvas. | [src/options.js](https://github.com/observablehq/plot/blob/main/src/options.js), [features/marks.md](https://github.com/observablehq/plot/blob/main/docs/features/marks.md), [features/scales.md](https://github.com/observablehq/plot/blob/main/docs/features/scales.md) |
| **Nivo** | Partly. The heatmap accepts `colors` as a function and applies its output verbatim (`if (typeof colors === 'function') return colors(cell)`), but then `colorScale` is `null`, so the built-in legend cannot be drawn. Every *inherited* colour (borders, label text derived "from" the cell colour) goes through `rgb(getColor(datum))` from d3-color, which cannot parse `var()`. The `theme` object (axis text, grid, tooltip) takes literal colour values, not CSS. | [heatmap/src/hooks.ts](https://github.com/plouc/nivo/blob/master/packages/heatmap/src/hooks.ts), [colors/src/inheritedColor.ts](https://github.com/plouc/nivo/blob/master/packages/colors/src/inheritedColor.ts) |
| **ECharts** | No, by maintainers' decision. On CSS variables: "we won't add this feature in the near future. We are trying to keep our API design independent from platforms" (#16044); "This feature won't be added since Canvas doesn't recognize the CSS variables currently. It's suggested to use `window.getComputedStyle(DOM).getPropertyValue('--the-css-var')` to get real color values before calling `setOption`" (#19743). Hover states are computed from the parsed normal colour, so `var()` fills glitch on emphasis. | [apache/echarts#16044](https://github.com/apache/echarts/issues/16044), [apache/echarts#19743](https://github.com/apache/echarts/issues/19743) |

Consequence for the lint rule: a library that needs resolved hex forces a `getComputedStyle` shim that turns tokens into hex at runtime and re-runs on theme change. The brand lint (`--color-<ramp>-*` in literals) would not even see that path — the hex literals it produces are not ramp references — so law 1 would be enforced by nothing. Hand SVG and Visx keep the fill in the same place the lint already looks.

## The rest of the comparison

### Rendering: SVG or canvas

- **Hand SVG, Visx, Plot** — SVG. Plot: "by default, plot returns an SVG element; however, if the plot includes a title, subtitle, legend, or caption, plot wraps the SVG element with an HTML figure element" ([features/plots.md](https://github.com/observablehq/plot/blob/main/docs/features/plots.md)).
- **Nivo** — SVG by default, with separate `*Canvas` components per chart type ([HeatMap.tsx](https://github.com/plouc/nivo/blob/master/packages/heatmap/src/HeatMap.tsx) is the SVG one).
- **ECharts** — canvas by default, SVG opt-in: `echarts.init(dom, null, { renderer: 'svg' })`; its own guidance is canvas for ">1k elements" and "heat maps, large-scale line charts, or scatter plots", SVG for "low-end devices" and memory ([handbook: canvas vs SVG](https://echarts.apache.org/handbook/en/best-practices/canvas-vs-svg/)).

At ≤2,400 rects plus ~40 circles and a handful of polylines, SVG is nowhere near the size where canvas earns its accessibility cost. Nothing here needs canvas.

### Bundle weight (minified / gzipped, bundlephobia 2026-09-20)

| Package | Version | min | gzip | Notes |
| --- | --- | --- | --- | --- |
| `d3-scale` | 4.0.2 | 47 KB | 16 KB | Pulls d3-array, d3-format, d3-interpolate, d3-time, d3-time-format |
| `d3-shape` | 3.2.0 | 33 KB | 5.7 KB | `line()` for the accept-rate chart |
| `d3-array` | 3.2.4 | 17 KB | 5.9 KB | `sum`, `extent`, `sort` for the axis ordering |
| `@visx/scale` | 4.0.0 | 51 KB | 17.5 KB | Wraps d3-scale via `@visx/vendor` |
| `@visx/shape` | 4.0.0 | 36 KB | 10.7 KB | |
| `@visx/xychart` | 4.0.0 | 151 KB | 50 KB | The batteries-included layer; not needed |
| `@observablehq/plot` | 0.6.17 | 385 KB | 128 KB | Depends on the whole `d3` (^7.9.0); `sideEffects` declared on `src/index.js`, so it does not tree-shake |
| `@nivo/line` | 0.99.0 | 285 KB | 96 KB | Plus `@react-spring/web`, lodash; heatmap and scatterplot are separate packages of similar make-up |
| `echarts` | 6.1.0 | 1,115 KB | 368 KB | Full build; the custom-build path trims it but still ships zrender |

The renderer is an Electron app and a LAN PWA (ADR 0001, 0005), so weight is a second-order concern — but 128 KB gz for Plot or 368 KB for ECharts is buying a lot of chart types the brief has explicitly cut ("growth charts, cluster maps, activity feeds" — Loose Ends; "no force-directed graph").

### React fit

- **Hand SVG / Visx** — the chart *is* React: `<rect onClick={…} tabIndex={0}>` with the app's own click-through, CSS Modules on `className`, tokens through the cascade. Visx: "visx combines the power of d3 to generate your visualization with the benefits of react for updating the DOM", "largely unopinionated and is meant to be built upon", "pick and choose the packages you need" ([README](https://github.com/airbnb/visx/blob/master/README.md)). Peer dep React ^18 || ^19.
- **Plot** — renders outside React. Its own guidance is `useEffect` + `containerRef.current.append(plot)` with `plot.remove()` on cleanup, or a virtual-`Document` SSR path ([getting-started.md](https://github.com/observablehq/plot/blob/main/docs/getting-started.md)). Per-element click handlers therefore mean `addEventListener` on the appended SVG or the `href` channel, and every update replaces the whole SVG — workable, but a second rendering model inside a React 19 renderer.
- **Nivo** — React components (peer React ^16.14–^19), animation through `@react-spring/web`, toggleable with `animate={false}` ([HeatMap.tsx](https://github.com/plouc/nivo/blob/master/packages/heatmap/src/HeatMap.tsx)).
- **ECharts** — imperative `setOption` on a DOM node; React wrappers exist but the option object is the API.

### Accessibility

- **Hand SVG / Visx** — whatever we write: `role="img"` + `<title>` on the figure, `role="button"`/`tabIndex` on cells, `aria-label` per point carrying the paper count the brief insists on ("Show the paper count behind every point"). Nothing is generated for us and nothing is in the way.
- **Plot** — channels `ariaLabel`, `ariaDescription`, `ariaHidden`, `title` ("an accessible, short-text description") per mark ([features/marks.md](https://github.com/observablehq/plot/blob/main/docs/features/marks.md)). Good coverage, but keyboard focus on individual cells still needs post-hoc DOM work.
- **Nivo** — `role`, `ariaLabel`, `ariaLabelledBy`, `ariaDescribedBy` on the SVG wrapper only ([HeatMap.tsx](https://github.com/plouc/nivo/blob/master/packages/heatmap/src/HeatMap.tsx)); per-cell semantics need custom cell components.
- **ECharts** — one generated `aria-label` on the container, plus `decal` patterns as "a secondary representation of color" ([handbook: aria](https://echarts.apache.org/handbook/en/best-practices/aria/)). On canvas there are no per-element nodes to focus or click through; the SVG renderer produces elements but not semantics.

### Licence

| | Licence | Source |
| --- | --- | --- |
| d3-* | ISC | npm registry, `d3-scale@4.0.2` |
| Visx | MIT | npm registry, `@visx/*@4.0.0` |
| Observable Plot | ISC | [package.json](https://github.com/observablehq/plot/blob/main/package.json) |
| Nivo | MIT | npm registry, `@nivo/*@0.99.0` |
| ECharts | Apache-2.0 | npm registry, `echarts@6.1.0` |

All compatible with a local-first desktop app; none is a differentiator.

## Recommendation

**D3 scales plus our own SVG in React** — `d3-scale`, `d3-array`, and `d3-shape` as the only chart dependencies (~28 KB gz together), every mark a React SVG element styled from `tokens.css` through `className` and `fill="var(--color-…)"`.

Why not the libraries:

- ECharts and Nivo fight law 1 at the design level (colours are JavaScript values; ECharts' maintainers have declined CSS variables; Nivo's inherited colours parse through d3-color). Both would need a `getComputedStyle` bridge that re-runs on theme change and that the brand lint cannot see.
- Plot passes `var()` through for constants and would probably do so for a threshold scale, but it renders outside React, imports all of d3 without tree-shaking, and draws continuous legends on canvas. Three charts do not justify a second rendering model.
- Visx is the honest runner-up: it keeps fills untouched and is React-native. But what it would contribute here — `HeatmapRect`, `Circle`, `LinePath`, `AxisLeft` — is a few dozen lines of SVG each, and its heatmap component assumes a binned-column data shape that the sorted matrix does not have (rows and columns are each sorted by their own totals; cells are looked up, not binned). The repo's code standard says "no abstraction until a second real use case needs it"; Visx is that abstraction arriving early, plus `classnames` and `@visx/vendor` as dependencies for the privilege.

What the hand-rolled version concretely is:

- **Matrix** — `scaleBand` for both axes over the *pre-sorted* question and tag arrays (`d3.sum` per row/column, `d3.sort` descending); `scaleThreshold([1, 2, 4, 8], ["var(--color-bg-sunken)", "var(--color-seq-1)", …, "var(--color-seq-4)"])` for the five prototype bins — the legend is the same five swatches, so no continuous ramp is ever needed. Each cell a `<rect role="button" tabIndex={0} aria-label="…">` with the click-through in `onClick`/`onKeyDown`. Column labels are `<text transform="rotate(-60)">` in `var(--font-mono)`.
- **Scatter** — `scaleLinear` × 2, `scaleSqrt` for radius so area tracks paper count, four `<text>` quadrant labels in the corners, the blind-spot quadrant's points `fill="var(--color-accent)"` and the rest `var(--color-series-1)`. The **unplaced band** is a separate HTML row of tag chips under the `<svg>`, exactly as the prototype draws it — not a y=0 row, so the brief's "Unplaced is not low" is structural rather than a styling choice.
- **Accept-rate line** — `d3-shape` `line()` into one `<path stroke="var(--color-accent)">`; the sparkline is the same component at 80 × 20 with axes off.
- **Funnel and ranked lists** — HTML `<div>` bars with `width: %`; no library at all.

Cost of being wrong: low. Scales are d3's either way, so a later move to Visx (which wraps the same d3-scale) or Plot changes the mark layer only, and the matrix/scatter/line are one component each.

## Open items for the spec (#141)

1. Confirm the five-bin threshold legend against the brief's "cell intensity showing how much material attaches" — binned is what the prototype drew and what tokens support; if a continuous ramp is ever wanted, `--color-seq-1..6` gives six steps and still no interpolation.
2. The brand lint currently checks CSS and TS/TSX string literals for ramp steps; `fill="var(--color-seq-3)"` in JSX is a semantic token and passes. Worth one RuleTester case so chart code is covered on purpose, not by accident.
3. The ranked-list fallback past ~40 questions is a data-shape decision, not a chart one, and belongs in the spec.
