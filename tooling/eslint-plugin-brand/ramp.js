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
