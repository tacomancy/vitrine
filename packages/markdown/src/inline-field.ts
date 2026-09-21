// `key:: value`, the Dataview inline-field shape, on a line of its own. The
// only body key-values the app parses are a criterion's `relationship::` and
// `outcome::` (ADR 0006 decision 2), but the grammar is the same for any key.

const INLINE_FIELD = /^([A-Za-z0-9_-]+)::[ \t]*/;

export interface ParsedInlineField {
  key: string;
  /** The rest of the line, trailing whitespace dropped. */
  value: string;
  /** Where the value begins in `line`: after the `::` and the spaces that follow it. */
  valueStart: number;
}

/** A field, or null when `line` does not begin with `key::`. */
export function parseInlineField(line: string): ParsedInlineField | null {
  const match = INLINE_FIELD.exec(line);
  if (!match) return null;
  const valueStart = match[0].length;
  return {
    key: match[1]!,
    value: line.slice(valueStart).trimEnd(),
    valueStart,
  };
}
