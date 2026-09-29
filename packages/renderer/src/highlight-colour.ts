/**
 * A highlight's colour for drawing (spec #416 "The Reader surface"). The
 * sidecar keeps the PDF's own colour verbatim and matching never sees it;
 * here it is *snapped* to the nearest of five names, and the name is a class
 * bound to a series token in `Reader.module.css`. The colour itself never
 * reaches a style attribute, so the brand lint polices what is drawn and the
 * frozen tokens stay untouched.
 *
 * The references are the 0–255 channels the viewers that write these files
 * use (Preview's yellow is `1, 0.85, 0.2`), not a palette of ours.
 */
export const HIGHLIGHT_COLOURS = [
  "blue",
  "green",
  "yellow",
  "pink",
  "purple",
] as const;
export type HighlightColour = (typeof HIGHLIGHT_COLOURS)[number];

const REFERENCE: Record<HighlightColour, readonly number[]> = {
  blue: [92, 176, 255],
  green: [126, 217, 87],
  yellow: [255, 217, 51],
  pink: [255, 128, 187],
  purple: [186, 130, 235],
};

/** A PDF with no colour on the annotation draws yellow, as every viewer does. */
export function snapColour(color: readonly number[] | null): HighlightColour {
  if (color === null || color.length < 3) return "yellow";
  let best: HighlightColour = "yellow";
  let bestDistance = Infinity;
  for (const name of HIGHLIGHT_COLOURS) {
    const ref = REFERENCE[name];
    const distance = ref.reduce((sum, c, i) => sum + (c - color[i]!) ** 2, 0);
    if (distance < bestDistance) {
      best = name;
      bestDistance = distance;
    }
  }
  return best;
}
