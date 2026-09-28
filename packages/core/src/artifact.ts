import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { posix } from "node:path";
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
 * A line under `## Artifacts` that is not one the page can read yet, shown
 * as written. Linked Artifacts arrive as their own kind with #369.
 */
export type ArtifactLine = StoredArtifact | { kind: "asWritten"; text: string };

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
      if (match === null) return { kind: "asWritten", text: line };
      const file = match[1]!.trim();
      const wanted = file.includes("/") ? file : `${folder}/${file}`;
      const found = await sized(vaultPath, wanted);
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

/** The line a stored Artifact is appended as: an ordinary embed, so Obsidian draws it too (story 44). */
export function storedLine(file: string, caption: string): string {
  const said = onOneLine(caption);
  return said === "" ? `- ![[${file}]]` : `- ![[${file}]] — ${said}`;
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
 *
 * The page's Kind is taken from the index, not by reading the file: a file
 * of another Kind must not get a copy beside it, and reading the page here
 * would be a second read the line's own write makes anyway.
 */
export async function addStoredArtifact(
  ctx: PageContext,
  page: PageKind,
  path: string,
  { source, caption }: { source: string; caption: string }
): Promise<WriteResult & { file: string }> {
  const { relativePath } = await locate(ctx.vaultPath, path);
  const [row] = ctx.index.select<{ kind: string | null }>(
    "SELECT kind FROM files WHERE path = ?",
    relativePath
  );
  if (row?.kind !== page.kind) {
    throw new VaultError("refused", `${relativePath} is not ${page.noun}.`);
  }
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
 * `experiments/<name>/`, a dot-entry, a symlink out of the vault, a folder,
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
  const parts = path.split("/");
  if (parts.length < 3 || parts[0] !== "experiments") return null;
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    return null;
  }
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
