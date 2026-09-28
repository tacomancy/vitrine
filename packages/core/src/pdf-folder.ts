import { lstat, readdir, readlink, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";

/** Where the PDFs sit in a vault (`docs/architecture.md` § Vault layout). */
export const PDF_FOLDER = "sources/pdf";

/**
 * Settings' *Where the PDFs are* (#378; `docs/architecture.md` § Settings):
 * facts about an arrangement the researcher made in Finder, each checkable
 * against it. `exists: false` is a vault with no `sources/pdf` yet, which is
 * a true sentence and never a fault. An entry that does not lead to a folder
 * that can be read is a `fault` (#379), and then nothing it would hold is
 * claimed: `resolves` and `holds` are null.
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
      /**
       * The newest PDF by mtime; null when there is none. `beforeFault` marks
       * the one `queue.sqlite` remembered, answered while the folder does not
       * resolve: *the last before it stopped resolving*.
       */
      lastArrived: { at: string; name: string; beforeFault: boolean } | null;
      fault: PdfFault | null;
    };

/**
 * Why the PDF folder does not resolve (#379). Worded here, once, and rendered
 * verbatim: `reason` by the footer channel after *papers not arriving*,
 * `resolvesTo` by Settings' *Resolves to* row. Neither carries a path (ADR
 * 0028) — the target as written is a fact on the *Folder* row, and the
 * sentence says what is wrong with it.
 */
export type PdfFault = {
  kind: PdfFaultKind;
  reason: string;
  resolvesTo: string;
};

export type PdfFaultKind = "target-gone" | "not-a-folder" | "unreadable";

const FAULTS: Record<PdfFaultKind, PdfFault> = {
  "target-gone": {
    kind: "target-gone",
    reason: "the PDF folder is a link to a folder that no longer exists",
    resolvesTo: "nothing — the link's target no longer exists",
  },
  "not-a-folder": {
    kind: "not-a-folder",
    reason: "the PDF folder leads to a file, not a folder",
    resolvesTo: "a file, not a folder",
  },
  unreadable: {
    kind: "unreadable",
    reason: "the PDF folder can't be read — check its permissions",
    resolvesTo: "a folder the app cannot read",
  },
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
  const faulted = (kind: PdfFaultKind): PdfFolder => ({
    exists: true,
    link,
    resolves: null,
    holds: null,
    lastArrived: null,
    fault: FAULTS[kind],
  });
  // Three separate steps because each failure is a different sentence: a
  // `realpath` that finds nothing is a link left dangling (ENOENT, or ELOOP
  // for a link that leads back to itself); one that finds a file is not a
  // folder; and a folder whose listing is refused cannot be counted. Any
  // other failure to resolve is also one the researcher fixes with
  // permissions, so it is `unreadable` rather than an unnamed error.
  let path: string;
  try {
    path = await realpath(entry);
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    return faulted(
      code === "ENOENT" || code === "ELOOP" ? "target-gone" : "unreadable"
    );
  }
  let pdfs: Pdf[];
  try {
    if (!(await stat(path)).isDirectory()) return faulted("not-a-folder");
    pdfs = await pdfsUnder(path);
  } catch {
    return faulted("unreadable");
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
        : {
            at: new Date(newest.mtimeMs).toISOString(),
            name: newest.name,
            beforeFault: false,
          },
    fault: null,
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
