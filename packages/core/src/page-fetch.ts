import type { ReadableStream } from "node:stream/web";

/**
 * One page, fetched with etiquette (`docs/architecture.md` § BYOK and
 * watched sources, *Fetch*): it says who is asking, reads `robots.txt` first
 * and treats a Disallow as a stated failure rather than a quiet one, gives up
 * at 30 s, refuses a response over 2 MB, and never retries within a run. A
 * Scout the site has asked not to be read is *broken with a reason*.
 */

export type PageFetchOptions = {
  fetch: typeof fetch;
  /** A test shortens it; the real one is 30 s. */
  timeoutMs?: number;
};

export type FetchErrorKind = "network" | "http";

export class FetchError extends Error {
  constructor(
    readonly kind: FetchErrorKind,
    message: string
  ) {
    super(message);
  }
}

export const USER_AGENT = "Vitrine/0.0.0 (+https://tacomancy.com/vitrine)";
export const TIMEOUT_MS = 30_000;
export const MAX_BYTES = 2 * 1024 * 1024;
export const DISALLOWED = "disallowed by robots.txt";

export type Page = { url: string; contentType: string; body: string };

export async function fetchPage(
  url: string,
  options: PageFetchOptions
): Promise<Page> {
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const get = async (target: string): Promise<Response> => {
    try {
      return await options.fetch(target, {
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new FetchError("network", "the page could not be reached");
    }
  };

  const target = new URL(url);
  const robots = await get(`${target.origin}/robots.txt`);
  if (robots.ok) {
    const rules = await readCapped(robots).catch(() => "");
    if (!allowed(rules, target.pathname + target.search)) {
      throw new FetchError("http", DISALLOWED);
    }
  }

  const response = await get(url);
  if (!response.ok) {
    throw new FetchError("http", `HTTP ${response.status}`);
  }
  return {
    url: response.url === "" ? url : response.url,
    contentType: response.headers.get("content-type") ?? "",
    body: await readCapped(response),
  };
}

/** The body, counted as it arrives: a response over the cap is refused, not truncated into a quiet partial read. */
async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_BYTES) throw tooBig();
  // `Response.body` is untyped under this project's libs; it is Node's stream.
  const reader = (
    response.body as ReadableStream<Uint8Array> | null
  )?.getReader();
  if (reader === undefined) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw tooBig();
      }
      chunks.push(value);
    }
  } catch (cause) {
    if (cause instanceof FetchError) throw cause;
    throw new FetchError("network", "the page could not be reached");
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

const tooBig = () => new FetchError("http", "the page is over 2 MB");

/**
 * Whether Vitrine may read this path: the group naming it, else `*`, with the
 * longest matching rule winning and Allow beating Disallow on a tie.
 */
export function allowed(robots: string, path: string): boolean {
  const groups: Array<{ agents: string[]; rules: Array<[boolean, string]> }> =
    [];
  let current: (typeof groups)[number] | null = null;
  let collecting = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const split = line.indexOf(":");
    if (split < 0) continue;
    const field = line.slice(0, split).trim().toLowerCase();
    const value = line.slice(split + 1).trim();
    if (field === "user-agent") {
      if (!collecting || current === null) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      collecting = true;
    } else if (field === "allow" || field === "disallow") {
      collecting = false;
      if (current !== null && value !== "") {
        current.rules.push([field === "allow", value]);
      }
    }
  }
  const group =
    groups.find((g) =>
      g.agents.some((a) => a !== "*" && "vitrine".includes(a))
    ) ?? groups.find((g) => g.agents.includes("*"));
  if (group === undefined) return true;
  let verdict: { allow: boolean; length: number } | null = null;
  for (const [allow, rule] of group.rules) {
    if (!matches(rule, path)) continue;
    const length = rule.length;
    if (
      verdict === null ||
      length > verdict.length ||
      (length === verdict.length && allow)
    ) {
      verdict = { allow, length };
    }
  }
  return verdict?.allow ?? true;
}

function matches(rule: string, path: string): boolean {
  const anchored = rule.endsWith("$");
  const body = anchored ? rule.slice(0, -1) : rule;
  const pattern = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${pattern}${anchored ? "$" : ""}`).test(path);
}
