/**
 * The five colours the Reader offers a highlight, and the 0–255 channels
 * each is written as. The renderer names one and never sends channels, so
 * what lands in `/C` is decided here; the renderer's `highlight-colour.ts`
 * snaps a PDF's colour back to the nearest of these by the same references,
 * which is what keeps a highlight drawn the colour it was made.
 */
export const HIGHLIGHT_COLOURS = [
  "blue",
  "green",
  "yellow",
  "pink",
  "purple",
] as const;
export type HighlightColour = (typeof HIGHLIGHT_COLOURS)[number];

export const HIGHLIGHT_RGB: Record<HighlightColour, number[]> = {
  blue: [92, 176, 255],
  green: [126, 217, 87],
  yellow: [255, 217, 51],
  pink: [255, 128, 187],
  purple: [186, 130, 235],
};
