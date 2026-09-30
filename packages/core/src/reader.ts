import { basename } from "node:path";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { readSidecar, type ReadingPosition } from "./annotation-sidecar.js";
import { VaultError } from "./errors.js";
import type { Ingest } from "./ingest.js";
import { questionText } from "./ingest.js";
import { readPageFile } from "./page-file.js";
import type { AnnotationKind } from "./pdf-engine.js";
import { PDF_FOLDER } from "./pdf-folder.js";
import { namedPath } from "./sources.js";
import { locate } from "./vault-files.js";
import type { VaultIndex } from "./vault-index.js";

/**
 * The Reader's side of the core (#424; spec #416 § The Reader surface): what
 * the window is told to draw a Source — its fields, where its PDF is, the
 * annotations the app draws as its own overlay — and the PDF's bytes. The
 * page itself is PDF.js's, in the renderer; nothing here reads the PDF, so a
 * Source that opens costs no engine job (`ingest.ts` is the only reader).
 */

/**
 * The kinds the overlay draws: text markup and notes (story 76). Ink,
 * stamps and shapes are not in this list because they are not redrawn — they
 * stay in the page bitmap exactly as the PDF has them (story 77), so the
 * pencil is never re-rendered by anything of ours.
 */
const DRAWN: ReadonlySet<AnnotationKind> = new Set([
  "highlight",
  "underline",
  "strikeout",
  "squiggly",
  "text",
  "freetext",
]);

/** One annotation as the overlay is made of it. Raw values: snapping a colour is drawing. */
export type ReaderAnnotation = {
  id: string;
  block: string;
  kind: AnnotationKind;
  /** 0-based, as the sidecar keeps it. */
  page: number;
  /** In PDF user space, as the file wrote them. */
  quads: number[][];
  /** The PDF's own colour, 0–255 per channel; null when it carries none. */
  color: number[] | null;
  note: string;
  quote: string;
  /** A `Q:` note, or one that has already spawned its Question: drawn with the `?` glyph. */
  question: boolean;
};

export type SourcePage =
  | {
      readable: true;
      path: string;
      citekey: string | null;
      title: string | null;
      authors: string[];
      year: string | null;
      /** The Source's own link, as written; the renderer decides whether it is one. */
      url: string | null;
      /** The PDF's vault path, or null when the Source names none the vault holds. */
      pdf: string | null;
      /** The PDF is a sync client's online-only file: bring it down, then it is ingested. */
      evicted: boolean;
      annotations: ReaderAnnotation[];
      position: ReadingPosition | null;
    }
  | { readable: false; path: string; reason: string };

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : typeof value === "number"
      ? String(value)
      : null;

/**
 * The PDF this Source's `pdf:` names, by the index: its vault path and
 * whether its bytes are on this Mac. No hash is what an evicted file looks
 * like (`vault-index.ts`); the same test Ingest skips it by.
 */
function heldPdf(
  index: VaultIndex,
  pdf: string | null
): { path: string; evicted: boolean } | null {
  if (pdf === null) return null;
  const [file] = index.select<{ path: string; hash: string | null }>(
    "SELECT path, hash FROM files WHERE markdown = 0 AND lpath = ?",
    namedPath(pdf)
  );
  return file === undefined
    ? null
    : { path: file.path, evicted: file.hash === null };
}

/** The page the Reader opens on, answered from the note and the sidecar alone. */
export async function readSourcePage(
  vaultPath: string,
  index: VaultIndex,
  path: string
): Promise<SourcePage> {
  const read = await readPageFile(vaultPath, path, ["source"], "a Source");
  if (!read.readable) return read;
  const front =
    (read.outline.frontmatter?.value as Record<string, unknown> | null) ?? {};
  const pdfName = text(front["pdf"]);
  const id = text(front["id"]);
  const held = heldPdf(index, pdfName);
  const sidecar = id === null ? null : await readSidecar(vaultPath, id);
  const authors = Array.isArray(front["authors"])
    ? front["authors"].flatMap((a) => text(a) ?? [])
    : [];
  return {
    readable: true,
    path: read.relativePath,
    citekey: text(front["citekey"]),
    title: text(front["title"]),
    authors,
    year: text(front["year"]),
    url: text(front["url"]),
    pdf: held?.path ?? null,
    evicted: held?.evicted ?? false,
    // What is not in the file now is not drawn: an annotation that is
    // removed, dropped, or waiting on a decision has geometry for a page
    // that no longer holds it, and drawing it would put a highlight where
    // nothing is (its row in Loose Ends is where it is dealt with).
    annotations: (sidecar?.annotations ?? []).flatMap((a) =>
      a.block === undefined ||
      !DRAWN.has(a.kind) ||
      a.removed_at !== undefined ||
      a.gone_at !== undefined ||
      a.unmatched_since !== undefined
        ? []
        : [
            {
              id: a.id,
              block: a.block,
              kind: a.kind,
              page: a.page,
              quads: a.quads,
              color: a.color,
              note: a.note,
              quote: a.quote,
              // A sticky note's words are its quote (`ingest.ts`).
              question:
                a.question !== undefined ||
                questionText(
                  a.kind === "text" || a.kind === "freetext" ? a.quote : a.note
                ) !== null,
            },
          ]
    ),
    position: sidecar?.reading_position ?? null,
  };
}

/**
 * One thing that points at this paper (spec #416 stories 83–86): a page
 * that links to the Source or to one of its blocks, or a Question whose
 * provenance names it. `block` is the annotation it points at, null when it
 * points at the paper as a whole; `page` is that annotation's (1-based) or,
 * for a Question with no block, the page it was asked on.
 */
export type Connection = {
  path: string;
  kind: string | null;
  name: string;
  block: string | null;
  page: number | null;
  /** An open Question: the one thing the gutter colours. */
  open: boolean;
};

/** `[[stem]]`, `[[stem|alias]]`, `[[stem#…]]`: the Source's own name, not a longer one that starts with it. */
const namesSource = (from: string, stem: string) =>
  from.toLowerCase().startsWith(`[[${stem.toLowerCase()}`) &&
  /^[|#\]]/.test(from.slice(stem.length + 2));

/**
 * What points at this paper and its highlights, from the index alone. Two
 * sources agree here because neither is complete: a link is any page's
 * `[[citekey#^h12]]`, but a Question captured from ingest or from the Reader
 * names its Source in `from:` and its highlight in `annotation:` and need
 * not be linked from anywhere (story 84). The Source's own note is left out —
 * it holds the blocks, it does not point at them. By page, then newest
 * first; what points at the paper as a whole has no page and follows.
 */
export async function readConnections(
  vaultPath: string,
  index: VaultIndex,
  path: string
): Promise<Connection[]> {
  const { id } = await sourceOf(vaultPath, path);
  const stem = basename(path, ".md");
  const sidecar = id === null ? null : await readSidecar(vaultPath, id);
  const pageOfBlock = new Map(
    (sidecar?.annotations ?? []).flatMap((a) =>
      a.block === undefined ? [] : [[a.block, a.page + 1] as const]
    )
  );
  type Row = {
    path: string;
    kind: string | null;
    name: string | null;
    mtime: number | null;
  };
  const found = new Map<string, Connection & { mtime: number }>();
  const add = (
    row: Row,
    block: string | null,
    asked: { page?: number; open: boolean }
  ) => {
    const key = `${row.path}\0${block ?? ""}`;
    if (found.has(key)) return;
    found.set(key, {
      path: row.path,
      kind: row.kind,
      name: row.name ?? basename(row.path, ".md"),
      block,
      page:
        (block === null ? null : (pageOfBlock.get(block) ?? null)) ??
        asked.page ??
        null,
      open: asked.open,
      mtime: row.mtime ?? 0,
    });
  };
  const statusOf = new Map(
    index
      .select<{ path: string; value: string }>(
        "SELECT path, value FROM fields WHERE key = 'status'"
      )
      .map((r) => [r.path, JSON.parse(r.value) as unknown])
  );
  const isOpen = (row: Row) =>
    row.kind === "question" &&
    (statusOf.get(row.path) === undefined || statusOf.get(row.path) === "open");
  for (const q of index.select<
    Row & { from: string; annotation: string | null; page: string | null }
  >(
    `SELECT f.path, f.kind, f.display AS name, f.mtime,
            json_extract(fr.value, '$') AS "from",
            json_extract(an.value, '$') AS annotation,
            pg.value AS page
       FROM files f
       JOIN fields fr ON fr.path = f.path AND fr.key = 'from'
       LEFT JOIN fields an ON an.path = f.path AND an.key = 'annotation'
       LEFT JOIN fields pg ON pg.path = f.path AND pg.key = 'page'
      WHERE f.kind = 'question'`
  )) {
    if (!namesSource(q.from, stem)) continue;
    add(q, q.annotation, {
      ...(q.page === null ? {} : { page: Number(q.page) }),
      open: isOpen(q),
    });
  }
  // After the Questions: one that names the Source in `from:` is already
  // a row, so a link to the same file (which has no block of its own) is
  // not a second one.
  const named = new Set([...found.values()].map((f) => f.path));
  for (const link of index.select<Row & { block: string | null }>(
    `SELECT DISTINCT l.path, f.kind, f.display AS name, f.mtime, l.block
       FROM links l JOIN files f ON f.path = l.path
      WHERE l.path <> ? AND (l.resolved_path = ? OR l.ltarget = ?)`,
    path,
    path,
    stem.toLowerCase()
  )) {
    if (link.block === null && named.has(link.path)) continue;
    add(link, link.block, { open: isOpen(link) });
  }
  return [...found.values()]
    .sort(
      (a, b) => (a.page ?? Infinity) - (b.page ?? Infinity) || b.mtime - a.mtime
    )
    .map(({ path, kind, name, block, page, open }) => ({
      path,
      kind,
      name,
      block,
      page,
      open,
    }));
}

/** The Source's `id:` and PDF, or why it has neither: what a write about a Source needs to find its sidecar. */
async function sourceOf(vaultPath: string, path: string) {
  const read = await readPageFile(vaultPath, path, ["source"], "a Source");
  if (!read.readable) throw new VaultError("refused", read.reason);
  const front =
    (read.outline.frontmatter?.value as Record<string, unknown> | null) ?? {};
  return { id: text(front["id"]), pdf: text(front["pdf"]) };
}

/**
 * Remember where the reader stopped. Through `ingest`'s queue, never beside
 * it (`Ingest.readingPosition`). Written: false when the Source has no
 * sidecar yet, which is not an error — nothing has been read from its PDF.
 */
export async function setReadingPosition(
  vaultPath: string,
  ingest: Ingest | null,
  path: string,
  position: ReadingPosition
): Promise<{ written: boolean }> {
  const { id } = await sourceOf(vaultPath, path);
  if (id === null || ingest === null) return { written: false };
  return ingest.readingPosition(id, position);
}

/**
 * *Open* on an evicted PDF (story 24): read it, so the sync client
 * downloads it, then let the index see its bytes and ingest it. Reading is
 * the whole of what brings a file down — the app never asks a sync client
 * anything else — and it is streamed to nowhere, since a large PDF must not
 * be held in memory only to be thrown away.
 */
export async function bringDown(
  vaultPath: string,
  index: VaultIndex,
  ingest: (paths: readonly string[]) => Promise<void>,
  path: string
): Promise<{ brought: boolean }> {
  const { pdf } = await sourceOf(vaultPath, path);
  const held = heldPdf(index, pdf);
  if (held === null || !held.evicted) return { brought: false };
  const { absolute } = await locate(vaultPath, held.path, { anyFile: true });
  try {
    for await (const chunk of createReadStream(absolute)) void chunk;
  } catch {
    return { brought: false };
  }
  await index.refresh([held.path]);
  // Still no hash: the sync client has not delivered the bytes. Nothing to
  // ingest, and the Reader keeps saying so.
  if (heldPdf(index, pdf)?.evicted !== false) return { brought: false };
  await ingest([held.path]);
  return { brought: true };
}

/** Only a PDF in the PDF folder is served: the route is not a way to read the vault. */
const servable = (path: string) =>
  path.toLowerCase().startsWith(`${PDF_FOLDER}/`) &&
  path.toLowerCase().endsWith(".pdf");

/**
 * The PDF's bytes for PDF.js (spec #416 "Open technical items"). Served with
 * `Range`, so the renderer never has to hold a large paper whole: PDF.js
 * asks for the pieces the page it is drawing needs. Behind the bearer header
 * like `/trpc`, which PDF.js carries as `httpHeaders`; the token never
 * travels in a URL. Anything not a PDF in the folder, or not there, is null
 * (a 404 that does not say which).
 */
export async function pdfBytes(
  vaultPath: string,
  path: string,
  range: string | undefined
): Promise<Response | null> {
  if (!servable(path)) return null;
  try {
    const { absolute } = await locate(vaultPath, path, { anyFile: true });
    const found = await stat(absolute);
    if (!found.isFile()) return null;
    const headers: Record<string, string> = {
      "content-type": "application/pdf",
      "accept-ranges": "bytes",
      "x-content-type-options": "nosniff",
    };
    const asked =
      range === undefined ? null : /^bytes=(\d*)-(\d*)$/.exec(range);
    if (asked === null) {
      return new Response(
        Readable.toWeb(createReadStream(absolute)) as ReadableStream,
        { headers: { ...headers, "content-length": String(found.size) } }
      );
    }
    // `bytes=-N` is the last N bytes, which PDF.js asks for to find the xref.
    const [, from = "", to = ""] = asked;
    const start =
      from === "" ? Math.max(found.size - Number(to), 0) : Number(from);
    const end =
      from === "" || to === ""
        ? found.size - 1
        : Math.min(Number(to), found.size - 1);
    if (start > end || start >= found.size) {
      return new Response(null, {
        status: 416,
        headers: { ...headers, "content-range": `bytes */${found.size}` },
      });
    }
    return new Response(
      Readable.toWeb(
        createReadStream(absolute, { start, end })
      ) as ReadableStream,
      {
        status: 206,
        headers: {
          ...headers,
          "content-range": `bytes ${start}-${end}/${found.size}`,
          "content-length": String(end - start + 1),
        },
      }
    );
  } catch {
    return null;
  }
}
