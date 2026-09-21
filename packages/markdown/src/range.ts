/** Half-open `[start, end)`, in UTF-16 code units into the source string — what `String.prototype.slice` takes. */
export interface Range {
  start: number;
  end: number;
}
