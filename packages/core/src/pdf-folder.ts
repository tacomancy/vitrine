import { lstat, readdir, readlink, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";

/** Where the PDFs sit in a vault (`docs/architecture.md` § Vault layout). */
export const PDF_FOLDER = "sources/pdf";

/**
 * Settings' *Where the PDFs are* (#378; `docs/architecture.md` § Settings):
 * facts about an arrangement the researcher made in Finder, each checkable
 * against it. `exists: false` is a vault with no `sources/pdf` yet, which is
 * a true sentence and never a fault. `resolves` is null when the entry does
 * not lead to a folder that can be read; which of those it is, and the
 * sentence that says so, is #379's.
 */
export type PdfFolder =
  | { exists: false }
  | {
      exists: true;
      /** The link's target as written, or null for a plain folder. */
      link: string | null;
      resolves: ResolvesTo | null;
      /** Every PDF under the folder, by stat: never opened. */
      holds: { count: number; bytes: number } | null;
      /** The newest PDF by mtime; null when there is none. */
      lastArrived: { at: string; name: string } | null;
    };

export type ResolvesTo = {
  /** `realpath` of the entry. */
  path: string;
  /** `iCloud Drive › Papers`, when the path sits under a sync root this knows. */
  known: string | null;
};

export async function readPdfFolder(vaultPath: string): Promise<PdfFolder> {
  const entry = join(vaultPath, PDF_FOLDER);
  let isLink: boolean;
  try {
    isLink = (await lstat(entry)).isSymbolicLink();
  } catch {
    return { exists: false };
  }
  const link = isLink ? await readlink(entry) : null;
  let path: string;
  let pdfs: Pdf[];
  try {
    path = await realpath(entry);
    if (!(await stat(path)).isDirectory()) throw new Error("not a folder");
    pdfs = await pdfsUnder(path);
  } catch {
    return {
      exists: true,
      link,
      resolves: null,
      holds: null,
      lastArrived: null,
    };
  }
  const newest = pdfs.reduce<Pdf | null>(
    (best, pdf) => (best === null || pdf.mtimeMs > best.mtimeMs ? pdf : best),
    null
  );
  return {
    exists: true,
    link,
    resolves: { path, known: knownLocation(path, homedir()) },
    holds: {
      count: pdfs.length,
      bytes: pdfs.reduce((total, pdf) => total + pdf.size, 0),
    },
    lastArrived:
      newest === null
        ? null
        : { at: new Date(newest.mtimeMs).toISOString(), name: newest.name },
  };
}

type Pdf = { name: string; size: number; mtimeMs: number };

/**
 * Stat only: a PDF synced from iCloud may be evicted to a placeholder, and
 * reading it to count it would download it. Dot entries are skipped as the
 * watcher skips them (`docs/architecture.md` § Decided, Watcher).
 */
async function pdfsUnder(folder: string): Promise<Pdf[]> {
  const entries = await readdir(folder, {
    recursive: true,
    withFileTypes: true,
  });
  const pdfs: Pdf[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.pdf$/i.test(entry.name)) continue;
    const full = join(entry.parentPath, entry.name);
    if (
      full
        .slice(folder.length)
        .split(sep)
        .some((part) => part.startsWith("."))
    )
      continue;
    const { size, mtimeMs } = await stat(full);
    pdfs.push({ name: entry.name, size, mtimeMs });
  }
  return pdfs;
}

/**
 * The sync roots a PDF folder is linked into in practice (ADR 0003), named
 * as Finder names them so the researcher can match them against the other
 * machine. Recognised by the shape of the path, not by asking the service,
 * which the app never talks to: the two `Library` roots by their own
 * distinctive segments wherever they sit, `~/Dropbox` only under `home`,
 * since a folder called Dropbox anywhere else is just a folder.
 */
export function knownLocation(path: string, home: string): string | null {
  const roots: Array<{ name: string; root: RegExp }> = [
    {
      name: "iCloud Drive",
      root: /\/Library\/Mobile Documents\/com~apple~CloudDocs(?=\/|$)/,
    },
    {
      name: "Dropbox",
      root: /\/Library\/CloudStorage\/Dropbox(?:-[^/]+)?(?=\/|$)/,
    },
    { name: "Dropbox", root: new RegExp(`^${escape(home)}/Dropbox(?=/|$)`) },
  ];
  for (const { name, root } of roots) {
    const match = root.exec(path);
    if (match === null) continue;
    const rest = path
      .slice(match.index + match[0].length)
      .split("/")
      .filter((part) => part !== "");
    return [name, ...rest].join(" › ");
  }
  return null;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
