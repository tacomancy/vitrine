import { readFile } from "node:fs/promises";
import { basename, join, posix } from "node:path";
import { stringify } from "yaml";
import { VaultError } from "./errors.js";
import { PDF_FOLDER } from "./pdf-folder.js";
import { PdfUnreadable, type PdfEngine } from "./pdf-engine.js";
import { serialised } from "./serialise.js";
import { createFile, readOutline, write } from "./vault-files.js";
import type { VaultIndex } from "./vault-index.js";

/**
 * The Source Kind's one hand path (#220; ADR 0020 decision 7; `docs/
 * architecture.md` § Vault layout, Source / Source stub): a stub made from
 * the attach form's four fields, so a fresh vault is not dead weight until
 * Scouts land. The record is what the Scout beat's *accept* will write
 * minus its Origin, and the citekey rule here is the one that beat reuses.
 */

/** Where the folder for papers is (§ Vault layout); the citekey names the file. */
const FOLDER = "sources";

/** What the form asks for, as typed: four strings, none of them parsed yet. */
export type StubFields = {
  title: string;
  /** One line of authors, separated by `;` — see `authorList`. */
  authors: string;
  year: string;
  url: string;
};

/** The stub as it now stands: its vault-relative path and the citekey it was filed under. */
export type Stub = { path: string; citekey: string };

/**
 * The authors as a list, one per semicolon. A comma cannot be the separator
 * here: it is already the bibliographic marker for surname-first, and
 * `Klinzing, J.` would split into two people whose surnames are `Klinzing`
 * and `J.`. A semicolon appears in no name, so the field stays unambiguous
 * however the names inside it are ordered — which is what the form's
 * placeholder says.
 */
export function authorList(authors: string): string[] {
  return authors
    .split(";")
    .map((author) => author.trim())
    .filter((author) => author !== "");
}

/**
 * `<surname><year>`, ASCII-folded and lowercased, with the first word of
 * the title standing in when no author was typed (§ Vault layout). The
 * `a`/`b` suffix on collision is not here: which citekeys are taken is a
 * fact about the disk, and this is the rule alone, so it reads off a table
 * of cases.
 */
export function citekeyFor({
  authors,
  year,
  title,
}: Pick<StubFields, "authors" | "year" | "title">): string {
  const first = authorList(authors)[0] ?? "";
  const stem = fold(surnameOf(first)) || titleWord(title);
  return stem + (year.match(/\d{4}/)?.[0] ?? "");
}

/**
 * `Klinzing, Jens G.` → `Klinzing`; `Jan Born` → `Born`. A comma is the
 * bibliographic marker for surname-first, and without one the surname is
 * the last word — which is where it is in every other order people type.
 */
function surnameOf(author: string): string {
  const comma = author.indexOf(",");
  if (comma !== -1) return author.slice(0, comma);
  const words = author.trim().split(/\s+/);
  return words[words.length - 1] ?? "";
}

/** The first word of the title that survives folding, or `source` when none does. */
function titleWord(title: string): string {
  for (const word of title.trim().split(/\s+/)) {
    const folded = fold(word);
    if (folded !== "") return folded;
  }
  // A title in a script ASCII cannot carry still has to name a file; the
  // suffix rule is what keeps a second one from colliding with the first.
  return "source";
}

/**
 * The letters that do not decompose under NFD: dropping them would turn
 * Sørensen into `srensen`, which reads as a typo rather than a fold. Every
 * other diacritic comes apart into a letter and a combining mark.
 */
const UNDECOMPOSED: Record<string, string> = {
  ø: "o",
  đ: "d",
  ð: "d",
  þ: "th",
  æ: "ae",
  œ: "oe",
  ß: "ss",
  ł: "l",
  ı: "i",
};

/** The same letters as a character class, so the two cannot drift apart. */
const UNDECOMPOSED_LETTERS = new RegExp(
  `[${Object.keys(UNDECOMPOSED).join("")}]`,
  "g"
);

/** Lowercased, diacritics folded away, and everything ASCII cannot spell dropped. */
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(UNDECOMPOSED_LETTERS, (letter) => UNDECOMPOSED[letter] ?? letter)
    .replace(/[^a-z0-9]/g, "");
}

/** Plain where YAML allows it, quoted by `yaml` where it does not. */
const plain = (value: string) => stringify(value, { lineWidth: 0 }).trim();

/**
 * The whole file: the keys § Vault layout lists, in its order, and none of
 * the ones this path cannot know — a field nobody filled in is absent, not
 * empty. The body is empty: a Scout's accept writes the abstract it was
 * given, and nobody typed one here.
 *
 * No `id:`, though § Vault layout says every app-owned object carries one:
 * the Source / Source stub key list starts at `citekey`, ADR 0016 d.9 pins
 * the same list for a Scout's accept, and the vault's own stubs have none.
 * A citekey already identifies a paper, and the two paths must write the
 * same record. Giving Sources an `id` is a decision for whoever needs one.
 */
function stubFile(
  citekey: string,
  { title, authors, year, url }: StubFields,
  held?: { id: string; pdf: string }
): string {
  const lines = [
    "---",
    held === undefined ? "kind: source-stub" : "kind: source",
    ...(held === undefined ? [] : [`id: ${held.id}`]),
    `citekey: ${citekey}`,
    `title: ${plain(title)}`,
  ];
  const people = authorList(authors);
  if (people.length > 0) {
    lines.push("authors:", ...people.map((author) => `  - ${plain(author)}`));
  }
  // A plain year stays a number, as the vault's own stubs write it; anything
  // else someone typed — `in press`, `2019a` — is kept as they typed it
  // rather than cut down to what the citekey took from it.
  if (year !== "") {
    lines.push(`year: ${/^\d+$/.test(year) ? year : plain(year)}`);
  }
  if (url !== "") lines.push(`url: ${plain(url)}`);
  if (held !== undefined) lines.push(`pdf: ${plain(held.pdf)}`);
  lines.push("---", "");
  return lines.join("\n");
}

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/** ``, `a`, `b`, … `z`, `aa`: what a taken citekey takes next. */
function suffix(n: number): string {
  let text = "";
  for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) {
    text = LETTERS[(i - 1) % 26] + text;
  }
  return text;
}

// Stubs are made one at a time. Picking a free citekey means reading the
// disk and then writing to it, and two that both found `born2010` free
// would write the same file: `createFile` checks for the path and then
// commits, so overlapping calls both pass the check and the second wins.
// The stub the user typed is gone and both calls report success — a silent
// failure, which is the one thing the vault may not do (`CLAUDE.md`
// § Invariants). Not a refusal, which is what this comment said before a
// test was pointed at it. The same hazard `link.ts` has, and
// `serialise.ts` holds the chain both use.
const serially = serialised();

/**
 * Write the stub and tell the index before returning, so the form can
 * attach it in the same breath (ADR 0010). A citekey already on disk takes
 * the next suffix rather than refusing: two papers by one author in one
 * year is ordinary, and the collision is the rule's own case, not an error
 * for the user to solve.
 */
export function createSourceStub(
  vaultPath: string,
  index: VaultIndex,
  fields: StubFields
): Promise<Stub> {
  return serially(() => makeStub(vaultPath, index, fields));
}

async function makeStub(
  vaultPath: string,
  index: VaultIndex,
  fields: StubFields,
  held?: { id: string; pdf: string }
): Promise<Stub> {
  const base = citekeyFor(fields);
  for (let n = 0; ; n++) {
    const citekey = base + suffix(n);
    const path = `${FOLDER}/${citekey}.md`;
    const created = await createFile(
      vaultPath,
      path,
      stubFile(citekey, fields, held)
    );
    if (created.written) {
      await index.own(path, created.content);
      return { path, citekey };
    }
    // `alreadyExists` is the collision; anything else is an I/O fault, and
    // retrying under another name would only write the fault somewhere new.
    if (created.reason !== "alreadyExists") {
      throw new VaultError(
        "writeFailed",
        `Couldn't write ${path}: ${created.detail}`
      );
    }
  }
}

/** The two Kinds that carry a `pdf:`; a stub may name a file before it is read. */
const PAPERS = ["source", "source-stub"];

const FOLDER_PREFIX = `${PDF_FOLDER}/`;

/** A PDF under `sources/pdf/`, however the case of its path is written. */
export const isPdfInFolder = (path: string) =>
  path.toLowerCase().startsWith(FOLDER_PREFIX) && /\.pdf$/i.test(path);

/** A PDF's path as a `pdf:` writes it: its own name, relative to the folder. */
const nameInFolder = (path: string) => path.slice(FOLDER_PREFIX.length);

/** What a `pdf:` key names, as the vault path the picker and this compare by. */
export const namedPath = (pdf: string) =>
  posix.join(PDF_FOLDER, pdf.trim()).toLowerCase();

/** The `pdf:` value of every paper, by the paper's path. */
export function pdfKeys(
  index: VaultIndex
): Array<{ path: string; pdf: string }> {
  const named: Array<{ path: string; pdf: string }> = [];
  for (const row of index.select<{ path: string; value: string }>(
    `SELECT f.path, fm.value FROM files f JOIN frontmatter fm USING (path)
      WHERE f.kind IN (${PAPERS.map(() => "?").join(", ")})`,
    ...PAPERS
  )) {
    const pdf = (JSON.parse(row.value) as Record<string, unknown> | null)?.[
      "pdf"
    ];
    if (typeof pdf === "string" && pdf.trim() !== "") {
      named.push({ path: row.path, pdf });
    }
  }
  return named;
}

/**
 * The PDFs under `sources/pdf/` that no Source or stub names (spec #416
 * story 4), by vault path. Read off the index alone.
 *
 * An evicted PDF — a sync client keeping it online-only — has no hash, and
 * is left out: nothing about it is opened, hashed or acted on until its
 * bytes are on disk (ADR 0013 decision 6), and the next sweep sees it again.
 */
export function unnamedPdfs(index: VaultIndex): string[] {
  const named = new Set(pdfKeys(index).map(({ pdf }) => namedPath(pdf)));
  return index
    .select<{ path: string; lpath: string }>(
      `SELECT path, lpath FROM files
        WHERE markdown = 0 AND hash IS NOT NULL
          AND lpath LIKE ? AND lpath LIKE '%.pdf'
        ORDER BY path`,
      `${PDF_FOLDER}/%`
    )
    .filter((row) => !named.has(row.lpath))
    .map((row) => row.path);
}

// Attaching reads a stub and writes it back, and a rename followed writes a
// Source's `pdf:` too; both run one at a time so neither plans against a
// file the other is about to change.
const attaching = serialised();

/**
 * The PDF a resolution acts on: in the folder, indexed, its bytes on this
 * Mac, and named by no paper. The refusals are the ones *attach* and
 * *create a Source* share, so neither can act on a file the other would not.
 */
function heldPdf(
  index: VaultIndex,
  pdf: string
): { path: string; hash: string } {
  if (!isPdfInFolder(pdf)) {
    throw new VaultError(
      "refused",
      `${pdf} is not a PDF in the PDF folder, so there is nothing to attach.`
    );
  }
  const held = index.select<{ path: string; hash: string | null }>(
    "SELECT path, hash FROM files WHERE markdown = 0 AND lpath = ?",
    pdf.toLowerCase()
  )[0];
  if (held === undefined) {
    throw new VaultError("refused", `There is no PDF at ${pdf}.`);
  }
  if (held.hash === null) {
    throw new VaultError(
      "refused",
      `${held.path} is not on this Mac yet; attach it once it has downloaded.`
    );
  }
  const wanted = held.path.toLowerCase();
  const owner = pdfKeys(index).find((key) => namedPath(key.pdf) === wanted);
  if (owner !== undefined) {
    throw new VaultError(
      "refused",
      `${owner.path} already names ${held.path}.`
    );
  }
  return { path: held.path, hash: held.hash };
}

/** What attaching did: the stub, now a Source, and the `id:` it was minted. */
export type Attached = { path: string; id: string };

/**
 * *Attach to a stub* (spec #416; "Attaching a PDF makes a Source", amending
 * ADR 0006 decision 7): one write that sets `pdf:` to the file's own name,
 * flips `kind` from source stub to source, and mints `id:` — a stub
 * deliberately has none, and the sidecar needs a key that survives a rename.
 * Links name the citekey, so none of them changes.
 *
 * The PDF is never opened, renamed, moved or copied: its name is whatever
 * it is called, relative to the folder.
 */
export function attachPdf(
  vaultPath: string,
  index: VaultIndex,
  { pdf, stub }: { pdf: string; stub: string },
  newId: () => string
): Promise<Attached> {
  return attaching(async () => {
    const held = heldPdf(index, pdf);
    const found = await readOutline(vaultPath, stub);
    const keys = found.readable
      ? (found.outline.frontmatter?.value as Record<string, unknown> | null)
      : null;
    if (!found.readable || keys?.["kind"] !== "source-stub") {
      throw new VaultError("refused", `${stub} is not a source stub.`);
    }
    const id = typeof keys["id"] === "string" ? keys["id"] : newId();
    const result = await write(vaultPath, found.path, {
      basedOn: found.hash,
      operations: [
        {
          op: "setFrontmatter",
          keys: {
            kind: "source",
            pdf: nameInFolder(held.path),
            id,
          },
        },
      ],
    });
    if (!result.written) {
      throw new VaultError(
        "refused",
        `Couldn't attach to ${found.path}: ${result.detail}`
      );
    }
    await index.own(found.path, result.content);
    return { path: found.path, id };
  });
}

/**
 * A PDF the user renamed in Finder keeps its Source (spec #416 story 12):
 * the watcher pairs the rename by content, and each paper naming the old
 * file is rewritten to name the new one. A file moved out of the PDF folder
 * is not followed — it has left the folder the Source's `pdf:` is read in.
 * One paper failing to take its rewrite is reported, and the rest still go.
 */
export function followPdfRenames(
  vaultPath: string,
  index: VaultIndex,
  pairs: ReadonlyArray<{ from: string; to: string }>
): Promise<void> {
  const moves = pairs.filter(
    ({ from, to }) => isPdfInFolder(from) && isPdfInFolder(to)
  );
  if (moves.length === 0) return Promise.resolve();
  return attaching(async () => {
    const failures: string[] = [];
    for (const { path, pdf } of pdfKeys(index)) {
      const move = moves.find(
        ({ from }) => namedPath(pdf) === from.toLowerCase()
      );
      if (move === undefined) continue;
      try {
        const found = await readOutline(vaultPath, path);
        if (!found.readable) throw new Error(found.reason);
        const result = await write(vaultPath, path, {
          basedOn: found.hash,
          operations: [
            {
              op: "setFrontmatter",
              keys: { pdf: nameInFolder(move.to) },
            },
          ],
        });
        if (!result.written) throw new Error(result.detail);
        await index.own(path, result.content);
      } catch (cause) {
        failures.push(
          `${path}: ${cause instanceof Error ? cause.message : String(cause)}`
        );
      }
    }
    if (failures.length > 0) {
      throw new VaultError(
        "writeFailed",
        `A renamed PDF could not be followed — ${failures.join("; ")}`
      );
    }
  });
}

/**
 * What the engine could not read, by the PDF's vault path (#418; spec #416
 * stories 65–67): held in memory, because nothing else has asked the engine
 * to open a PDF yet. `hash` is the bytes the failure was about — a file
 * replaced since is a different file and no longer this row.
 */
export type UnreadablePdfs = Map<string, { hash: string; reason: string }>;

/** The engine and the record of what it could not read; one per core. */
export type PdfReads = { engine: PdfEngine; unreadable: UnreadablePdfs };

/** What *create a Source* did: the new paper, or why the file would not read. */
export type Created =
  | { readable: true; path: string; citekey: string; id: string }
  | { readable: false; reason: string };

/**
 * *Create a Source* on a no-Source row (spec #416 stories 6–9; "Creating a
 * Source from a PDF"): title and authors from the file's own metadata, the
 * file name standing in for a missing title and every other field absent
 * rather than guessed, and the citekey from the rule a hand-made stub gets.
 * The file is written as a Source at once — `pdf:` and a minted `id:` —
 * rather than as a stub to attach, because the PDF is the reason for it.
 *
 * A file the engine cannot read is not a refusal but an answer: it goes on
 * the unreadable record, becomes the *PDF unreadable* row, and is not
 * offered to the engine again until *try again* (`retryUnreadable`).
 */
export function createSourceFromPdf(
  vaultPath: string,
  index: VaultIndex,
  { pdf }: { pdf: string },
  { reads, newId }: { reads: PdfReads; newId: () => string }
): Promise<Created> {
  // Both queues: this writes a new Source (`serially`, for the citekey) and
  // names a PDF (`attaching`, so an attach cannot claim the same file).
  return attaching(() =>
    serially(async () => {
      const held = heldPdf(index, pdf);
      if (reads.unreadable.get(held.path)?.hash === held.hash) {
        throw new VaultError(
          "refused",
          `${held.path} could not be read; use try again on its row.`
        );
      }
      const read = await readMetadata(vaultPath, held.path, reads.engine);
      if ("reason" in read) {
        reads.unreadable.set(held.path, {
          hash: held.hash,
          reason: read.reason,
        });
        return { readable: false, reason: read.reason };
      }
      const id = newId();
      const stub = await makeStub(
        vaultPath,
        index,
        {
          title: read.title ?? basename(held.path).replace(/\.pdf$/i, ""),
          // As the file wrote it: `;` separates people (`authorList`), and
          // anything else stays one author rather than a guessed split.
          authors: read.author ?? "",
          year: "",
          url: "",
        },
        { id, pdf: nameInFolder(held.path) }
      );
      return { readable: true, ...stub, id };
    })
  );
}

/**
 * *Try again* on a *PDF unreadable* row: the engine is asked once, now, and
 * the answer replaces the record. Never called but by the researcher — a
 * file that stopped the reader is not retried in a loop (story 66). A file
 * that reads this time is simply a no-Source row again.
 */
export function retryUnreadable(
  vaultPath: string,
  index: VaultIndex,
  { pdf }: { pdf: string },
  reads: PdfReads
): Promise<{ readable: boolean; reason?: string }> {
  return attaching(async () => {
    const held = heldPdf(index, pdf);
    if (!reads.unreadable.has(held.path)) {
      throw new VaultError("refused", `${held.path} is not marked unreadable.`);
    }
    const read = await readMetadata(vaultPath, held.path, reads.engine);
    if ("reason" in read) {
      reads.unreadable.set(held.path, { hash: held.hash, reason: read.reason });
      return { readable: false, reason: read.reason };
    }
    reads.unreadable.delete(held.path);
    return { readable: true };
  });
}

async function readMetadata(
  vaultPath: string,
  path: string,
  engine: PdfEngine
) {
  try {
    return await engine.metadata(await readFile(join(vaultPath, path)));
  } catch (cause) {
    if (cause instanceof PdfUnreadable) return { reason: cause.reason };
    // A file that cannot even be read from disk is unreadable too, in words
    // that carry no path (ADR 0028).
    return { reason: "the file could not be read from the disk" };
  }
}
