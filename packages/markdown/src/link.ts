// help.obsidian.md/links: the two link syntaxes, parsed and never resolved.

export interface LinkTarget {
  /** The file as written, `""` for a link into the same file (`[[#Heading]]`). */
  target: string;
  /** `[[note#H1#H2]]` → `["H1", "H2"]`, each kept as written (L4b). */
  heading: string[];
  /** `[[note#^id]]` → `"id"`. */
  blockId: string | null;
}

export interface ParsedWikilink extends LinkTarget {
  /** `[[note|alias]]` → `"alias"`; the size on an image embed (`|200`, L1h). */
  alias: string | null;
}

/**
 * The text between `[[` and `]]`. The first unescaped `|` starts the alias;
 * `\|` is the pipe as Obsidian writes it inside a table (L1k) and reads as one.
 */
export function parseWikilink(inner: string): ParsedWikilink {
  const pipe = /(?<!\\)\||\\\|/.exec(inner);
  const address = pipe ? inner.slice(0, pipe.index) : inner;
  const alias = pipe ? inner.slice(pipe.index + pipe[0].length) : null;
  return { ...parseFragment(address), alias };
}

/** The `#`-separated address into a file: `target#H1#H2` or `target#^id`. */
function parseFragment(address: string): LinkTarget {
  const [target = "", ...fragments] = address.split("#");
  let blockId: string | null = null;
  const heading: string[] = [];
  for (const fragment of fragments) {
    if (fragment.startsWith("^")) blockId = fragment.slice(1);
    else heading.push(fragment);
  }
  return { target, heading, blockId };
}

export interface ParsedMarkdownLinkTarget extends LinkTarget {
  /** A URL with a scheme; left exactly as written, `%20` included (L1j vs the URL case). */
  external: boolean;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** The destination of `[text](destination)`: a note path is percent-decoded, a URL is not. */
export function parseMarkdownLinkTarget(url: string): ParsedMarkdownLinkTarget {
  if (SCHEME.test(url)) {
    return { target: url, heading: [], blockId: null, external: true };
  }
  const parsed = parseFragment(url);
  return { ...parsed, target: decode(parsed.target), external: false };
}

function decode(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
