import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { posix } from "node:path";
import { Readable } from "node:stream";
import { VaultError } from "./errors.js";
import { writeOwn, type PageContext, type PageKind } from "./page-write.js";
import { bodyText, section } from "./page-file.js";
import { onOneLine } from "./position-history.js";
import type { VaultIndex } from "./vault-index.js";
import { artifactName } from "./file-name.js";
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
  /** Drawn as its first rows (story 36), from `artifactPreview`. */
  rows: boolean;
};

/**
 * A line under `## Artifacts` that is not one the page can read yet, shown
 * as written. Linked Artifacts arrive as their own kind with #369.
 */
export type ArtifactLine = StoredArtifact | { kind: "asWritten"; text: string };

/**
 * A file in the Experiment's folder that no line names (ADR 0035 decision
 * 3; stories 41–43): a plot a script wrote there, a file dragged in from
 * Finder, or one whose line was removed. Drawn as *in the folder, not on
 * the page*, with *show it here*. `file` is its name in the folder — what
 * `showArtifact` and `artifactPreview` take, and what its line will embed.
 */
export type InFolderArtifact = {
  kind: "inFolder";
  file: string;
  path: string;
  size: number | null;
  image: boolean;
  rows: boolean;
};

/** A text Artifact's head (story 36): its first lines, and whether the file goes on past them. */
export type ArtifactPreview = { lines: string[]; more: boolean };

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

// What the page draws as its first rows: a data snippet or a sample output,
// read as text (story 36). Anything else is an image or a named card.
const ROW_EXTENSIONS = new Set(["csv", "tsv", "txt", "log", "json", "jsonl"]);

// The prototype's CSV card says *first 6 rows*. The byte cap is what bounds
// the read, since a minified JSON or a log with no line breaks is one row.
const PREVIEW_ROWS = 6;
const PREVIEW_BYTES = 16 * 1024;

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
 * The vault path a line's file is looked for at: beside the page — where
 * the app puts it, and where Obsidian looks first — unless the embed names a
 * vault path of its own. Null when it is not a file the page could draw.
 */
function artifactPath(pagePath: string, file: string): string | null {
  const wanted = file.includes("/")
    ? file
    : `${posix.dirname(pagePath)}/${file}`;
  return servable(wanted) ? wanted : null;
}

type ParsedLine =
  | { kind: "stored"; file: string; caption: string }
  | { kind: "asWritten"; text: string };

function parsedLines(text: string): ParsedLine[] {
  return text
    .split("\n")
    .map((line) => /^\s*[-*+]\s+(.*)$/.exec(line)?.[1]?.trim())
    .filter((line): line is string => line !== undefined && line !== "")
    .map((line) => {
      const match = STORED.exec(line);
      if (match === null) return { kind: "asWritten", text: line };
      return {
        kind: "stored",
        file: match[1]!.trim(),
        caption: (match[2] ?? "").trim(),
      };
    });
}

/**
 * Every vault path the section's lines name, lowercased: the Mac's disk
 * does not tell `Plot.png` from `plot.png`, so a line naming either names
 * the one file, and the file is not also offered as off the page.
 */
function namedPaths(pagePath: string, text: string): Set<string> {
  const named = new Set<string>();
  for (const line of parsedLines(text)) {
    if (line.kind !== "stored") continue;
    const path = artifactPath(pagePath, line.file);
    if (path !== null) named.add(path.toLowerCase());
  }
  return named;
}

/** The section's lines, in the user's order (story 38). */
export async function artifactLines(
  vaultPath: string,
  pagePath: string,
  text: string
): Promise<ArtifactLine[]> {
  return Promise.all(
    parsedLines(text).map(async (line): Promise<ArtifactLine> => {
      if (line.kind === "asWritten") return line;
      const wanted = artifactPath(pagePath, line.file);
      const found = wanted === null ? null : await sized(vaultPath, wanted);
      return {
        ...line,
        path: found === null ? null : wanted,
        size: found,
        ...drawnAs(line.file),
      };
    })
  );
}

const drawnAs = (file: string) => ({
  image: extension(file) in IMAGE_TYPES,
  rows: ROW_EXTENSIONS.has(extension(file)),
});

/**
 * The files in the Experiment's folder that no line names (ADR 0035
 * decision 3), read from the index — the file is an Index row with no line
 * on the page, which is the decision's own wording, and the watcher is what
 * makes a script's new plot a row.
 *
 * Only the folder itself, not the folders below it: a run's `checkpoints/`
 * holding a thousand steps is not a thousand things to offer, and a file a
 * script wants on the page it writes straight into the folder (story 41).
 * The page's own `.md`, and any other note, is never an Artifact.
 */
export function inFolderArtifacts(
  index: VaultIndex,
  pagePath: string,
  text: string
): InFolderArtifact[] {
  const prefix = `${posix.dirname(pagePath)}/`;
  const named = namedPaths(pagePath, text);
  const rows = index.select<{ path: string; size: number | null }>(
    "SELECT path, size FROM files WHERE lpath LIKE ? ESCAPE '\\' ORDER BY path",
    `${prefix.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  );
  return rows
    .filter(
      ({ path }) =>
        path.startsWith(prefix) &&
        !path.slice(prefix.length).includes("/") &&
        servable(path) &&
        !named.has(path.toLowerCase())
    )
    .map(({ path, size }) => {
      const file = path.slice(prefix.length);
      return { kind: "inFolder", file, path, size, ...drawnAs(file) };
    });
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
export async function addStoredArtifact(
  ctx: PageContext,
  page: PageKind,
  path: string,
  { source, caption }: { source: string; caption: string }
): Promise<WriteResult & { file: string }> {
  const relativePath = await experimentPath(ctx, page, path);
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
 * The page's vault path, once the index says it is the Kind asked for. The
 * Kind is taken from the index, not by reading the file: a file of another
 * Kind must not get a copy beside it, and reading the page here would be a
 * second read the line's own write makes anyway.
 */
async function experimentPath(
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
 * *show it here* (ADR 0035 decision 3; story 42): the stored line for a
 * file already in the run's folder, appended — and nothing else. The file
 * is not copied, renamed or touched, so its bytes and date stay exactly as
 * the script that wrote it left them.
 *
 * Only a file directly in the folder, which is all the page offers; and not
 * one a line already names, since a second line would draw it twice. That
 * check is made against the file as the write reads it, not as the page
 * last drew it.
 *
 * A name a copy would have cleaned (`artifactName`) is refused rather than
 * written: `![[run#3.png]]` is read — here and by Obsidian — as `run` with
 * a heading, so the line would name a file that is not there and the file
 * would stay offered, one broken line per click. The app never renames a
 * file it did not take in (ADR 0035 decision 2), so the user is told to.
 */
export async function showStoredArtifact(
  ctx: PageContext,
  page: PageKind,
  path: string,
  { file, caption }: { file: string; caption: string }
): Promise<WriteResult> {
  const relativePath = await experimentPath(ctx, page, path);
  const wanted = file.includes("/") ? null : artifactPath(relativePath, file);
  if (wanted === null || (await sized(ctx.vaultPath, wanted)) === null) {
    throw new VaultError(
      "refused",
      `${file} is not a file in the run's folder.`
    );
  }
  if (artifactName(file) !== file) {
    throw new VaultError(
      "refused",
      `${file} cannot be embedded as it is named: a link reads # | ^ [ ] as something else. Rename it in the folder to show it here.`
    );
  }
  return writeOwn(ctx, relativePath, page, (read) => {
    const text = bodyText(
      read.content,
      section(read.outline, "Artifacts").heading
    );
    if (namedPaths(relativePath, text).has(wanted.toLowerCase())) {
      throw new VaultError("refused", `${file} is already on the page.`);
    }
    return {
      operations: [
        {
          op: "appendToSection",
          target: { section: "Artifacts" },
          line: storedLine(file, caption),
        },
      ],
      basedOn: read.hash,
    };
  });
}

/**
 * A CSV, TSV or text Artifact's first rows (story 36), for the card to draw
 * without the page ever holding the file whole: only the head is read, so a
 * 2 GB log costs what a 2 KB one does. `file` is named as a line names it,
 * and is refused — without saying why, as the bytes route is — when it is
 * not a text file the page could draw.
 *
 * Rows are lines. A quoted CSV field with a line break in it splits across
 * two, which a snippet read at a glance can bear better than a parser that
 * has to guess at a file cut off mid-field.
 */
export async function artifactPreview(
  ctx: PageContext,
  page: PageKind,
  path: string,
  file: string
): Promise<ArtifactPreview> {
  const vaultPath = ctx.vaultPath;
  const noRows = new VaultError("refused", `${file} has no rows to show.`);
  const wanted = artifactPath(await experimentPath(ctx, page, path), file);
  if (wanted === null || !ROW_EXTENSIONS.has(extension(file))) throw noRows;
  let head: Buffer;
  let size: number;
  try {
    const { absolute } = await locate(vaultPath, wanted, { anyFile: true });
    const handle = await open(absolute, "r");
    try {
      const found = await handle.stat();
      if (!found.isFile()) throw noRows;
      size = found.size;
      const buffer = Buffer.alloc(Math.min(size, PREVIEW_BYTES));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      head = buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  } catch {
    throw noRows;
  }
  const lines = head
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/);
  // A final newline is not a row; a head cut short ends in a partial one,
  // which is still shown, since it is the most of that row there is.
  if (head.length === size && lines.at(-1) === "") lines.pop();
  return {
    lines: lines.slice(0, PREVIEW_ROWS),
    more: lines.length > PREVIEW_ROWS || head.length < size,
  };
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
