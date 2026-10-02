/**
 * What makes two finds the same paper (ADR 0017; `docs/architecture.md`
 * § BYOK and watched sources): the arXiv id when the link is an arXiv link,
 * else the DOI, else the normalised link. That precedence is why a lab page
 * and an arXiv Scout produce one card with two Appearances. Matching on
 * title stays out: a false merge hides a paper, and only an identical key
 * is warrant for it (ADR 0039 decision 1).
 */

const TRACKING =
  /^(?:utm_.*|fbclid|gclid|mc_cid|mc_eid|igshid|ref|ref_src|_hsenc|_hsmi|source)$/i;

const ARXIV =
  /^https?:\/\/(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf)\/(.+?)(?:v\d+)?(?:\.pdf)?\/?$/i;

export function arxivIdOf(url: string): string | null {
  return ARXIV.exec(url.trim().split(/[?#]/)[0]!)?.[1] ?? null;
}

/** A DOI carried by a `doi.org` link, lower-cased: DOIs are case-insensitive. */
export function doiOf(url: string): string | null {
  const found = /^https?:\/\/(?:dx\.)?doi\.org\/(10\..+?)\/?$/i.exec(
    url.trim().split(/[?#]/)[0]!
  );
  return found?.[1] === undefined
    ? null
    : decodeURIComponent(found[1]).toLowerCase();
}

export function sourceKeyOf(url: string): string {
  const arxiv = arxivIdOf(url);
  if (arxiv !== null) return `arxiv:${arxiv}`;
  const doi = doiOf(url);
  if (doi !== null) return `doi:${doi}`;
  return `url:${normalise(url)}`;
}

function normalise(link: string): string {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return link.trim();
  }
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING.test(key)) url.searchParams.delete(key);
  }
  const path = url.pathname.replace(/\/+$/, "");
  const query = url.searchParams.toString();
  // `URL` has already lower-cased scheme and host and dropped a default port.
  return `${url.protocol}//${url.host}${path}${query === "" ? "" : `?${query}`}`;
}
