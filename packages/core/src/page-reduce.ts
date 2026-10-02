/**
 * HTML to the text a model is shown (`docs/architecture.md` § BYOK and
 * watched sources, *Reduce*): scripts, styles and navigation stripped, links
 * kept as `[text](href)` with the address made absolute, so the page is paid
 * for as content and not chrome, and so a link the model copies is a string
 * that occurs in what it was shown. Verification is a substring test against
 * exactly this text — which is why reduction is deterministic and why the
 * hash of it can tell a changed page from a re-served one.
 */

const STRIPPED = [
  "script",
  "style",
  "noscript",
  "svg",
  "head",
  "nav",
  "header",
  "footer",
];

const BLOCK =
  /<\/?(?:p|div|li|ul|ol|br|tr|table|section|article|h[1-6]|dt|dd|blockquote|main|aside|form)\b[^>]*>/gi;

export function reduceHtml(html: string, base: string): string {
  let text = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of STRIPPED) {
    text = text.replace(
      new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, "gi"),
      " "
    );
  }
  text = text.replace(
    /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi,
    (whole, attrs: string, inner: string) => {
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
      const target = absolute(decode(href?.[1] ?? href?.[2] ?? ""), base);
      const label = collapse(decode(inner.replace(/<[^>]+>/g, " ")));
      return target === null || label === ""
        ? ` ${inner} `
        : ` [${label}](${target}) `;
    }
  );
  text = text.replace(BLOCK, "\n").replace(/<[^>]+>/g, " ");
  return decode(text)
    .split("\n")
    .map(collapse)
    .filter((line) => line !== "")
    .join("\n");
}

function absolute(href: string, base: string): string | null {
  if (
    href === "" ||
    href.startsWith("#") ||
    /^(?:javascript|mailto):/i.test(href)
  ) {
    return null;
  }
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

const collapse = (value: string) => value.replace(/\s+/g, " ").trim();

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decode(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|\w+);/gi,
    (whole, entity: string) => {
      if (entity.startsWith("#x"))
        return String.fromCodePoint(parseInt(entity.slice(2), 16));
      if (entity.startsWith("#"))
        return String.fromCodePoint(parseInt(entity.slice(1), 10));
      return ENTITIES[entity.toLowerCase()] ?? whole;
    }
  );
}
