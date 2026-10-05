// BRAND.md law 1: components read semantic tokens, never ramp steps. The ramps
// are the raw material tokens.css is built from; nothing else may name one.
const RAMPS = [
  "sapphire",
  "teal",
  "emerald",
  "brass",
  "copper",
  "garnet",
  "amethyst",
  "ink",
  "paper",
];

export const RAMP_TOKEN = new RegExp(
  `--color-(?:${RAMPS.join("|")})(?![a-z])[a-z0-9-]*`,
  "g"
);

/** The only file allowed to define or reference a ramp step. */
export function isTokensFile(filename) {
  return /(^|[\\/])tokens\.css$/.test(filename);
}

// BRAND.md law 1 again, from the other side: chart code binds colour by class
// name, so a literal in a string or a stylesheet is a value tokens.css can't
// see or re-theme. The lookbehind spares `&#123;`; the lookahead spares
// `#abcdefg`; a 3–4 digit hex with no letter in it is an issue number (`#482`),
// so `#000` is the one literal this lets through.
export const COLOR_LITERAL =
  /(?<![\w&])#(?:[0-9a-f]{8}|[0-9a-f]{6}|(?=\d*[a-f])[0-9a-f]{3,4})(?![\w-])|\b(?:rgba?|hsla?|oklch)\(/gi;
