// `^id` as Obsidian writes and reads it: Latin letters, digits, dashes.

const BLOCK_ID = /^\^([A-Za-z0-9-]+)$/;

/** The id named by a `^id` marker, or null when the text is not one. */
export function parseBlockId(text: string): string | null {
  return BLOCK_ID.exec(text)?.[1] ?? null;
}

/** Is this UTF-16 code unit allowed in a block id? */
export function isBlockIdCharacter(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x2d
  );
}
