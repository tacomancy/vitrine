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
  "footer",
];

// A <header> is chrome only where HTML makes it the page's banner: not inside
// article, aside, main, nav or section (nav is already gone by then). Inside
// those it is a card's or a section's own heading, which is where a listing
// puts each paper's date (#881) — so those stay, and only the banner goes.
// The name must end at the tag's end: `\b` would also match `<header-logo>`,
// whose closer would then end the banner early.
const SECTIONING =
  /<(\/?)(article|aside|main|section|header)(?=[\s/>])[^>]*>/gi;

function stripBanners(html: string): string {
  let kept = "";
  let from = 0;
  let within = 0;
  let bannerStart = -1;
  for (const match of html.matchAll(SECTIONING)) {
    const closing = match[1] === "/";
    const tag = match[2]!.toLowerCase();
    if (tag !== "header") {
      within = Math.max(0, within + (closing ? -1 : 1));
    } else if (!closing && bannerStart < 0 && within === 0) {
      kept += html.slice(from, match.index);
      bannerStart = match.index;
    } else if (closing && bannerStart >= 0) {
      // No nesting to count: HTML does not allow a header inside a header.
      kept += " ";
      from = match.index + match[0].length;
      bannerStart = -1;
    }
  }
  // An unclosed banner is kept, as the whole-element strip always left it.
  return kept + html.slice(bannerStart >= 0 ? bannerStart : from);
}

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
  // After the strips above, so a tag inside a script cannot move the count.
  text = stripBanners(text);
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

/** Collapse whitespace the way reduction does, so a value that wrapped in the markup still compares equal. */
export const squash = (value: string) => value.replace(/\s+/g, " ").trim();

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
