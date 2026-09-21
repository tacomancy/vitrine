// `key:: value`, the Dataview inline-field shape, on a line of its own. The
// only body key-values the app parses are a criterion's `relationship::` and
// `outcome::` (ADR 0006 decision 2), but the grammar is the same for any key.
// The key rule is written once, on code units, for the tokenizer's sake.

/** Is this UTF-16 code unit allowed in a field key? Letters, digits, `_`, `-`. */
export function isInlineFieldKeyCharacter(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x5f ||
    code === 0x2d
  );
}

const TRAILING_BLOCK_ID = /\s+\^[A-Za-z0-9-]+$/;

export interface ParsedInlineField {
  key: string;
  /** The rest of the line, trailing whitespace and a trailing `^id` dropped. */
  value: string;
  /** Where the value begins in `line`: after the `::` and the spaces that follow it. */
  valueStart: number;
}

/** A field, or null when `line` does not begin with `key::`. */
export function parseInlineField(line: string): ParsedInlineField | null {
  let keyEnd = 0;
  while (
    keyEnd < line.length &&
    isInlineFieldKeyCharacter(line.charCodeAt(keyEnd))
  ) {
    keyEnd++;
  }
  if (keyEnd === 0 || !line.startsWith("::", keyEnd)) return null;
  let valueStart = keyEnd + 2;
  while (line[valueStart] === " " || line[valueStart] === "\t") valueStart++;
  // A `^id` ending the line is the block's marker, not the value — as on a
  // heading line — so a writer replacing the value leaves it standing.
  const value = line.slice(valueStart).trimEnd().replace(TRAILING_BLOCK_ID, "");
  return { key: line.slice(0, keyEnd), value, valueStart };
}
