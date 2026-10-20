import type { SearchHit } from "core";

/** A hit's line with each found term in a `<mark>`; the offsets are the core's. */
export function Marked({ line, marks }: Pick<SearchHit, "line" | "marks">) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [from, to] of marks) {
    if (from < at) continue;
    parts.push(line.slice(at, from));
    parts.push(<mark key={from}>{line.slice(from, to)}</mark>);
    at = to;
  }
  parts.push(line.slice(at));
  return <>{parts}</>;
}
