import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { basename, posix } from "node:path";
import { Readable } from "node:stream";
import { VaultError } from "./errors.js";
import { writeOwn, type PageContext, type PageKind } from "./page-write.js";
import { onOneLine } from "./position-history.js";
import { copyArtifact, locate, type WriteResult } from "./vault-files.js";

/**
 * An Experiment's Artifacts (ADR 0035; `docs/architecture.md` § Vault layout
 * (Experiment), § Experiment view; spec #362 stories 28–44): the lines under
 * `## Artifacts` as the page draws them, a stored one added by copying the
 * file in, and the bytes served to the page that draws it.
 */

/**
 * A stored Artifact: `- ![[plot.png]] — caption`, the file beside the page
 * in the Experiment's folder. `path` and `size` are null when the line names
 * a file the folder does not hold — the line is still shown, since what the
 * user wrote is never dropped.
 */
export type StoredArtifact = {
  kind: "stored";
  file: string;
  caption: string;
  /** Vault-relative; what the bytes route serves. */
  path: string | null;
  size: number | null;
  /** Drawn inline at the column's width (story 35), rather than as a named card. */
  image: boolean;
};

/**
 * A linked Artifact (ADR 0035 decision 5; stories 39–40): `- <file> —
 * <path or URL> · <size> · <date> · <machine> · <fingerprint> —
 * <description>`, the file left where it was. Every field is read as
 * written, since the line is the record and Obsidian is its other reader.
 * A URL has no `size` and no `fingerprint`: nothing is fetched to learn
 * them (spec #362 § Out of Scope).
 */
export type LinkedArtifact = {
  kind: "linked";
  file: string;
  /** The path on the machine it was linked on, or the URL. */
  target: string;
  url: boolean;
  /** As the line writes it — `2.4 GB` — for the page to show. */
  size: string | null;
  /** The day it was linked, `YYYY-MM-DD`. */
  date: string;
  /** The computer it was linked on. */
  machine: string;
  /** `<size>:<mtime>:<sha256 of first and last MiB, first 12 hex>`. */
  fingerprint: string | null;
  description: string;
};

/**
 * A line under `## Artifacts` as the page reads it: stored, linked, or a
 * line of neither shape, shown as written.
 */
export type ArtifactLine =
  StoredArtifact | LinkedArtifact | { kind: "asWritten"; text: string };

/** Stored or linked: what `inspectArtifact` proposes and what the user chose. */
export type ArtifactAs = "stored" | "linked";

const MIB = 1024 * 1024;

/**
 * At or above this a file is proposed as linked, below it as stored (KEEP-9,
 * #94). A proposal only — the user overrides it per Artifact — and a code
 * constant, never a Setting (ADR 0035 decision 4). Mebibytes, so the size
 * the page shows beside a file just under it reads as under.
 */
export const LINK_AT = 25 * MIB;

/**
 * What the bytes route answers with for each extension the page draws as an
 * image: an `<img>` over an object URL needs the type to decode it. Anything
 * else is a named card and is never fetched.
 */
const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

const extension = (file: string) =>
  /\.([^./]+)$/.exec(file)?.[1]?.toLowerCase() ?? "";

// `![[name]]`, `![[name|300]]` (a width), then ` — caption`. The embed is
// Obsidian's grammar; the dash is the app's, as a source line's is.
const STORED = /^!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\](?:\s+—\s+(.*))?$/;

/**
 * Whether a vault path is one the page can draw: a file inside an
 * Experiment's folder that is not the page itself. The page read and the
 * bytes route both ask this, so a line is never offered as *in vault* and
 * then refused its bytes.
 */
function servable(path: string): boolean {
  const parts = path.split("/");
  return (
    parts.length >= 3 &&
    parts[0] === "experiments" &&
    !parts.some((part) => part === "" || part === "." || part === "..") &&
    !path.endsWith(".md")
  );
}

/**
 * The section's lines, in the user's order (story 38). A stored line's file
 * is looked for beside the page — where the app puts it, and where Obsidian
 * looks first — unless the embed names a vault path of its own.
 */
export async function artifactLines(
  vaultPath: string,
  pagePath: string,
  text: string
): Promise<ArtifactLine[]> {
  const folder = posix.dirname(pagePath);
  const lines = text
    .split("\n")
    .map((line) => /^\s*[-*+]\s+(.*)$/.exec(line)?.[1]?.trim())
    .filter((line): line is string => line !== undefined && line !== "");
  return Promise.all(
    lines.map(async (line): Promise<ArtifactLine> => {
      const match = STORED.exec(line);
      if (match === null) {
        return linkedFrom(line) ?? { kind: "asWritten", text: line };
      }
      const file = match[1]!.trim();
      const wanted = file.includes("/") ? file : `${folder}/${file}`;
      const found = servable(wanted) ? await sized(vaultPath, wanted) : null;
      return {
        kind: "stored",
        file,
        caption: (match[2] ?? "").trim(),
        path: found === null ? null : wanted,
        size: found,
        image: extension(file) in IMAGE_TYPES,
      };
    })
  );
}

/** A vault file's size, or null when it is not a file the vault holds. */
async function sized(vaultPath: string, path: string): Promise<number | null> {
  try {
    const { absolute } = await locate(vaultPath, path, { anyFile: true });
    const found = await stat(absolute);
    return found.isFile() ? found.size : null;
  } catch {
    return null;
  }
}

// A URL is anything with a scheme — `https://`, but also `s3://` or
// `gs://`, where heavy outputs often live. A path on disk never starts so.
const URL_TARGET = /^[a-z][a-z0-9+.-]*:\/\//i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FINGERPRINT = /^\d+:\d+:[0-9a-f]{12}$/;

/**
 * A linked line, or null when the line is not one. The fields are read from
 * the right, so a path is whatever is left of them and keeps a ` · ` of its
 * own; the description is everything after the second dash, so it keeps
 * one of its own too.
 */
function linkedFrom(line: string): LinkedArtifact | null {
  const [file, middle, ...rest] = line.split(" — ");
  if (file === undefined || middle === undefined || file.trim() === "") {
    return null;
  }
  const fields = middle.split(" · ");
  const description = rest.join(" — ").trim();
  const last = fields.at(-1) ?? "";
  if (FINGERPRINT.test(last) && fields.length >= 5) {
    const [size, date, machine, fingerprint] = fields.slice(-4) as [
      string,
      string,
      string,
      string,
    ];
    const target = fields.slice(0, -4).join(" · ");
    if (!DATE.test(date) || machine === "" || target === "") return null;
    return {
      kind: "linked",
      file: file.trim(),
      target,
      url: false,
      size,
      date,
      machine,
      fingerprint,
      description,
    };
  }
  if (fields.length >= 3) {
    const [date, machine] = fields.slice(-2) as [string, string];
    const target = fields.slice(0, -2).join(" · ");
    if (!DATE.test(date) || machine === "" || !URL_TARGET.test(target)) {
      return null;
    }
    return {
      kind: "linked",
      file: file.trim(),
      target,
      url: true,
      size: null,
      date,
      machine,
      fingerprint: null,
      description,
    };
  }
  return null;
}

/** Bytes as the prototype writes them: `412 KB`, `2.4 GB`. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MIB) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * MIB) return `${(bytes / MIB).toFixed(1)} MB`;
  return `${(bytes / (1024 * MIB)).toFixed(1)} GB`;
}

/** A field of the linked line on one line and free of the line's own separators, so it reads back as the field it was. */
const asField = (text: string) =>
  onOneLine(text)
    .replace(/\s*[·—]\s*/g, " ")
    .trim();

/**
 * The linked line (ADR 0035 decision 5), as `docs/architecture.md` § Vault
 * layout (Experiment) spells it.
 */
function linkedLine(artifact: Omit<LinkedArtifact, "kind" | "url">): string {
  const fields = [
    artifact.target,
    ...(artifact.size === null ? [] : [artifact.size]),
    artifact.date,
    asField(artifact.machine),
    ...(artifact.fingerprint === null ? [] : [artifact.fingerprint]),
  ];
  return `- ${asField(artifact.file)} — ${fields.join(" · ")} — ${onOneLine(artifact.description)}`;
}

/** Refused in the words `copyArtifact` uses, so a stored and a linked add fail alike. */
const unreadable = (source: string) =>
  new VaultError(
    "refused",
    `${basename(source)} is not a file that can be read.`
  );

/**
 * Stored or linked, proposed by size (stories 29–30; ADR 0035 decision 4).
 * A URL is linked, with no size: nothing is fetched to learn one.
 */
export async function inspectArtifact(
  source: string
): Promise<{ size: number | null; proposed: ArtifactAs }> {
  if (URL_TARGET.test(source)) return { size: null, proposed: "linked" };
  let found;
  try {
    found = await stat(source);
  } catch {
    throw unreadable(source);
  }
  if (!found.isFile()) throw unreadable(source);
  return {
    size: found.size,
    proposed: found.size < LINK_AT ? "stored" : "linked",
  };
}

/**
 * A file's Fingerprint (ADR 0035 decision 5): its size, its modification
 * time in whole milliseconds, and the first 12 hex of a SHA-256 of its first
 * and last mebibyte — enough to tell an edited or replaced file from the one
 * linked without reading a 40 GB checkpoint whole (the ADR's rejected full
 * hash). A file of 2 MiB or less is hashed whole, since its ends are all of
 * it. Size and time come from the open handle, so all three describe the
 * same file even if the path is replaced mid-read.
 *
 * Off the request thread: the reads are the handle's, and the digest is
 * WebCrypto's, both of which run on libuv's pool, so hashing 2 MiB never
 * holds up another request.
 */
async function fingerprintOf(
  source: string
): Promise<{ size: number; fingerprint: string }> {
  let handle;
  try {
    handle = await open(source, "r");
  } catch {
    throw unreadable(source);
  }
  try {
    const found = await handle.stat();
    if (!found.isFile()) throw unreadable(source);
    const { size } = found;
    const ends: Array<[position: number, length: number]> =
      size <= 2 * MIB
        ? [[0, size]]
        : [
            [0, MIB],
            [size - MIB, MIB],
          ];
    const bytes = Buffer.alloc(
      ends.reduce((sum, [, length]) => sum + length, 0)
    );
    let offset = 0;
    for (const [position, length] of ends) {
      let got = 0;
      while (got < length) {
        const { bytesRead } = await handle.read(
          bytes,
          offset + got,
          length - got,
          position + got
        );
        // Shorter than its stat said: it changed under the read.
        if (bytesRead === 0) throw unreadable(source);
        got += bytesRead;
      }
      offset += length;
    }
    const digest = Buffer.from(await crypto.subtle.digest("SHA-256", bytes));
    const sha = digest.toString("hex").slice(0, 12);
    return { size, fingerprint: `${size}:${Math.floor(found.mtimeMs)}:${sha}` };
  } finally {
    await handle.close();
  }
}

/** The name a URL's card goes by: its last path segment, or its host when it has none. */
function urlName(url: string): string {
  try {
    const parsed = new URL(url);
    const segment = parsed.pathname.split("/").filter(Boolean).at(-1);
    return segment === undefined
      ? parsed.host || url
      : decodeURIComponent(segment);
  } catch {
    return url;
  }
}

/**
 * Add a linked Artifact (stories 30, 39–40; ADR 0035 decision 5): its line
 * appended, nothing copied. The file is only read, for its Fingerprint; a
 * URL is not read at all.
 */
async function addLinkedArtifact(
  ctx: PageContext,
  page: PageKind,
  relativePath: string,
  { source, caption }: { source: string; caption: string },
  { machine, today }: { machine: string; today: string }
): Promise<WriteResult & { file: string }> {
  const url = URL_TARGET.test(source);
  const file = url ? urlName(source) : basename(source);
  const measured = url ? null : await fingerprintOf(source);
  const line = linkedLine({
    file,
    target: source,
    size: measured === null ? null : formatSize(measured.size),
    date: today,
    machine,
    fingerprint: measured?.fingerprint ?? null,
    description: caption,
  });
  const result = await writeOwn(ctx, relativePath, page, (read) => ({
    operations: [
      { op: "appendToSection", target: { section: "Artifacts" }, line },
    ],
    basedOn: read.hash,
  }));
  return { ...result, file };
}

/**
 * Add an Artifact as the user chose — stored or linked, whatever was
 * proposed (story 31). A URL can only be linked.
 */
export async function addArtifact(
  ctx: PageContext,
  page: PageKind,
  path: string,
  input: { source: string; as: ArtifactAs; caption: string },
  linkedOn: { machine: string; today: string }
): Promise<WriteResult & { file: string }> {
  if (input.as === "stored" && URL_TARGET.test(input.source)) {
    throw new VaultError(
      "refused",
      "A URL can only be linked: there is no file to copy in."
    );
  }
  const relativePath = await requireKind(ctx, page, path);
  return input.as === "stored"
    ? addStoredArtifact(ctx, page, relativePath, input)
    : addLinkedArtifact(ctx, page, relativePath, input, linkedOn);
}

/**
 * The page's vault path, once the index says it is `page`'s Kind. Taken
 * from the index, not by reading the file: a file of another Kind must get
 * neither a copy beside it nor a line, and reading the page here would be a
 * second read the line's own write makes anyway.
 */
async function requireKind(
  ctx: PageContext,
  page: PageKind,
  path: string
): Promise<string> {
  const { relativePath } = await locate(ctx.vaultPath, path);
  const [row] = ctx.index.select<{ kind: string | null }>(
    "SELECT kind FROM files WHERE path = ?",
    relativePath
  );
  if (row?.kind !== page.kind) {
    throw new VaultError("refused", `${relativePath} is not ${page.noun}.`);
  }
  return relativePath;
}

/**
 * The line a stored Artifact is appended as: an ordinary embed, so Obsidian
 * draws it too (story 44). The caption is required — the router refuses a
 * blank one, as the page's caption line does — because a plot that does not
 * say what it shows is a chip by another name (story 34).
 */
export function storedLine(file: string, caption: string): string {
  return `- ![[${file}]] — ${onOneLine(caption)}`;
}

/**
 * Add a stored Artifact (stories 28, 32–34; ADR 0035 decision 1): the file
 * copied into the Experiment's folder, then its line appended to
 * `## Artifacts`.
 *
 * The copy lands first, and is recorded as the app's own write before the
 * line is attempted. So a line that cannot be written leaves a file in the
 * folder — which the page offers as *in the folder, not on the page* (#368)
 * — rather than a line naming a file that never arrived, or a result lost
 * between the two. The answer carries the stored name either way, so the
 * page can say where the file went when the line did not follow.
 */
async function addStoredArtifact(
  ctx: PageContext,
  page: PageKind,
  relativePath: string,
  { source, caption }: { source: string; caption: string }
): Promise<WriteResult & { file: string }> {
  const copied = await copyArtifact(
    ctx.vaultPath,
    source,
    posix.dirname(relativePath)
  );
  await ctx.index.ownFile(copied.path, copied.hash);
  const result = await writeOwn(ctx, relativePath, page, (read) => ({
    operations: [
      {
        op: "appendToSection",
        target: { section: "Artifacts" },
        line: storedLine(copied.file, caption),
      },
    ],
    basedOn: read.hash,
  }));
  return { ...result, file: copied.file };
}

/**
 * An Artifact's bytes for the page to draw (#366): a file in an Experiment's
 * folder, streamed with its type. Anything else — a path outside
 * `experiments/<name>/`, the page itself, a dot-entry, a symlink out of the vault, a folder,
 * a file that is not there — is null, which the route answers as 404
 * without saying which, since the route is not a way to probe the disk.
 *
 * The route sits behind the bearer header like `/trpc`: an `<img src>`
 * cannot carry one and the token never travels in a URL, so the page
 * fetches the bytes and draws them from an object URL.
 */
export async function artifactBytes(
  vaultPath: string,
  path: string
): Promise<Response | null> {
  if (!servable(path)) return null;
  try {
    const { absolute } = await locate(vaultPath, path, { anyFile: true });
    const found = await stat(absolute);
    if (!found.isFile()) return null;
    const body = Readable.toWeb(createReadStream(absolute)) as ReadableStream;
    return new Response(body, {
      headers: {
        "content-type":
          IMAGE_TYPES[extension(path)] ?? "application/octet-stream",
        "content-length": String(found.size),
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return null;
  }
}
