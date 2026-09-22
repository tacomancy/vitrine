import { parseWikilink } from "markdown";

/**
 * How a `[[link]]` reads on a surface: its alias when it has one, else the
 * target with the fragment that names what inside it was meant. The grammar
 * is `packages/markdown`'s — a second copy of it here is what ADR 0008
 * decision 7 exists to prevent — and this is only the display rule around it.
 */
export function linkLabel(link: string): string {
  const inner = /^\[\[(.*)\]\]$/.exec(link)?.[1] ?? link;
  const { target, heading, blockId, alias } = parseWikilink(inner);
  if (alias !== null) return alias;
  const fragments = heading.map((h) => `#${h}`);
  if (blockId !== null) fragments.push(`#^${blockId}`);
  return target + fragments.join("");
}
