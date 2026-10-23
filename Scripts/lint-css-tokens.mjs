// The UI lint. Phase one (#785): the renderer's CSS reaches spacing,
// font size, radius and colour through tokens, never a raw `px` or hex value.
// Layout dimensions (width, height, grid tracks, offsets) are exempt: no token
// scale covers them. Where a raw value is deliberate it goes in ALLOWED below,
// each with the reason, so a drive-by value cannot slip in unseen.
//
// Phase two (#792): a component reaches a button or a fieldset through the
// shared primitives in Form.tsx, never a bare `<button>` or `<fieldset>`.
// ALLOWED_MARKUP below is a ratchet, not a licence: a count per file, so a new
// bare control in any file fails, and a migrated one forces the count down.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SPACING = /^(padding|margin)(-[a-z]+)*$|^(gap|row-gap|column-gap)$/;
// `font` is the shorthand that carries a size.
const FONT_SIZE = /^font(-size)?$/;
const RADIUS = /^border(-[a-z]+)*-radius$/;
const COLOUR =
  /^(color|background(-color|-image)?|border(-[a-z]+)*|outline(-color)?|box-shadow|text-shadow|fill|stroke|caret-color|accent-color|text-decoration(-color)?)$/;

// A non-zero px length. The lookbehind keeps it off identifiers and numbers
// it would otherwise match the tail of (`--space-1px`, `1.5px` as `5px`).
const RAW_PX = /(?<![\w.-])-?\d*\.?\d*[1-9]\d*(\.\d+)?px\b/;
// Hex, or a colour function: both are literals the palette tokens replace.
const COLOUR_LITERAL =
  /#[0-9a-fA-F]{3,8}\b|\b(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(/i;

const HAIRLINE =
  "below the 4px space scale (smallest token is --space-1); optical spacing";
const PROTOTYPE_12 =
  "prototype 12's own off-grid measure (see FirstSlot.module.css header)";

// A deliberate raw value: the file (renderer-relative), the property and the
// exact value. Matched by value, not line, so an edit above does not orphan it.
export const ALLOWED = [
  ["CaptureLine.module.css", "padding", "2px 7px", HAIRLINE],
  ["GlobalCommand.module.css", "padding", "2px 7px", HAIRLINE],
  ["GlobalCommand.module.css", "padding", "1px 6px", HAIRLINE],
  ["Inbox.module.css", "padding", "1px 5px", HAIRLINE],
  ["Hypothesis.module.css", "gap", "2px", HAIRLINE],
  ["charts/matrix.module.css", "gap", "2px", HAIRLINE],
  ["Sidebar.module.css", "gap", "1px", HAIRLINE],
  ["Sidebar.module.css", "gap", "2px", HAIRLINE],
  [
    "Sidebar.module.css",
    "gap",
    "9px",
    "optical gap between a row's glyph and its label",
  ],
  [
    "Sidebar.module.css",
    "padding",
    "6px var(--space-2)",
    "optical row padding, between --space-1 and --space-2",
  ],
  [
    "Sidebar.module.css",
    "border-radius",
    "1px",
    "a 2px-wide rule's rounding; below --radius-sm",
  ],
  ["FirstSlot.module.css", "gap", "10px", PROTOTYPE_12],
  ["FirstSlot.module.css", "margin", "22px var(--space-5) 0", PROTOTYPE_12],
  [
    "TitleBar.module.css",
    "padding-left",
    "78px",
    "clears the inset macOS traffic lights; a platform measure, not a scale step",
  ],
  [
    "TitleBar.module.css",
    "padding-right",
    "78px",
    "mirrors the left inset so the title stays centred",
  ],
  [
    "Reader.module.css",
    "font-size",
    "9px",
    "a glyph-sized badge label, below --text-2xs",
  ],
  [
    "Vault.module.css",
    "font-size",
    "calc(0.09px * var(--u, 1))",
    "graph labels scale with the zoom unit --u, not the type scale",
  ],
].map(([file, prop, value, reason]) => ({ file, prop, value, reason }));

const REFUSED =
  "a refused link drawn as plainly not a link (architecture.md, UI conventions: What stays as it is)";
const CHOOSES =
  "a row, swatch or chooser (aria-pressed, aria-current, menu item) that is itself the thing it names (architecture.md, UI conventions: What stays as it is)";

// Bare controls that stay: choosers and rows that are what they name. Each
// count is exact; the test fails if the source has fewer, so the list can
// only shrink.
export const ALLOWED_MARKUP = [
  ["AnnotationControls.tsx", 1, CHOOSES],
  ["AttentionPanel.tsx", 1, CHOOSES],
  ["CadenceMenu.tsx", 1, CHOOSES],
  ["Experiments.tsx", 2, CHOOSES],
  ["HighlightBar.tsx", 1, CHOOSES],
  ["Inbox.tsx", 1, CHOOSES],
  ["PositionHistory.tsx", 1, CHOOSES],
  ["QuestionMap.tsx", 1, CHOOSES],
  ["Reader.tsx", 1, REFUSED],
  ["ScoutQueue.tsx", 3, CHOOSES],
].map(([file, count, reason]) => ({ file, count, reason }));

// The primitives themselves are where the bare elements live.
const PRIMITIVES = "Form.tsx";

function strip(css) {
  // Keep newlines so reported line numbers stay true.
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

export function lintCss(css, file = "<css>", allowed = []) {
  const text = strip(css);
  const problems = [];
  // Whole-text scan, not per line: a prettier-wrapped value spans lines.
  for (const m of text.matchAll(/([a-zA-Z-]+)\s*:\s*([^;{}]+)/g)) {
    const prop = m[1].toLowerCase();
    const rawValue = m[2].replace(/\s+/g, " ").trim();
    // Strip the token name but keep any fallback: `var(--c, <literal>)`
    // is still a literal.
    const value = rawValue.replace(/var\(\s*--[\w-]+\s*/g, "(");
    const kind = SPACING.test(prop)
      ? "spacing"
      : FONT_SIZE.test(prop)
        ? "font-size"
        : RADIUS.test(prop)
          ? "radius"
          : COLOUR.test(prop)
            ? "colour"
            : null;
    if (!kind) continue;
    // Border, outline and shadow shorthands carry a hairline width beside
    // the colour; only the colour must be a token there.
    const raw = COLOUR_LITERAL.test(value)
      ? "colour literal"
      : kind !== "colour" && RAW_PX.test(value)
        ? "px"
        : null;
    if (!raw) continue;
    if (
      allowed.some(
        (a) => a.file === file && a.prop === prop && a.value === rawValue
      )
    )
      continue;
    const line = text.slice(0, m.index).split("\n").length;
    problems.push({
      file,
      line,
      prop,
      value: rawValue,
      message: `${file}:${line}: raw ${raw} in ${prop} (${kind}); use a token`,
    });
  }
  return problems;
}

function filesWith(dir, keep) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? e.name === "node_modules" || e.name === "dist"
        ? []
        : filesWith(join(dir, e.name), keep)
      : keep(e.name)
        ? [join(dir, e.name)]
        : []
  );
}

const cssFiles = (dir) => filesWith(dir, (n) => n.endsWith(".css"));
// Tests render whatever they like; only shipped components are held to it.
const componentFiles = (dir) =>
  filesWith(dir, (n) => n.endsWith(".tsx") && !/\.test\.tsx$/.test(n));

export function lintMarkup(src, file = "<tsx>", allowed = []) {
  // Block and line comments, newlines kept so line numbers stay true.
  const text = src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^[ \t]*\/\/.*$/gm, "");
  const found = [...text.matchAll(/<(button|fieldset)\b/g)].map((m) => ({
    tag: m[1],
    line: text.slice(0, m.index).split("\n").length,
  }));
  // Only buttons are tolerated: no surface has a bare fieldset to ratchet.
  const buttons = found.filter((f) => f.tag === "button").length;
  const tolerated = allowed.find((a) => a.file === file)?.count ?? 0;
  if (buttons <= tolerated && buttons === found.length) return [];
  // Over the count, report every site: which of them is the new one is not
  // something a count can say.
  return found.map(({ tag, line }) => ({
    file,
    line,
    message: `${file}:${line}: bare <${tag}>; use the primitives in ${PRIMITIVES}`,
  }));
}

export function lintMarkupTree(root, allowed = ALLOWED_MARKUP) {
  return componentFiles(root)
    .filter((f) => relative(root, f) !== PRIMITIVES)
    .flatMap((f) =>
      lintMarkup(readFileSync(f, "utf8"), relative(root, f), allowed)
    );
}

export function lintTree(root, allowed = ALLOWED) {
  return cssFiles(root).flatMap((f) =>
    lintCss(readFileSync(f, "utf8"), relative(root, f), allowed)
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = [
    ...lintTree("packages/renderer/src"),
    ...lintMarkupTree("packages/renderer/src"),
  ];
  for (const p of problems) console.error(p.message);
  process.exit(problems.length ? 1 : 0);
}
