import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Document, isMap, parseDocument } from "yaml";
import { writeAtomically } from "./atomic-write.js";
import { ArxivError } from "./arxiv.js";
import { VaultError } from "./errors.js";
import { readScouts, SCOUTS_FOLDER, type Scout } from "./scout-file.js";
import { faultSentence } from "./scout-health.js";
import { runScout, type RunSummary, type ScoutDeps } from "./scouts.js";
import { serialised } from "./serialise.js";

/**
 * Making and changing a Scout without a file editor (spec #447 stories 1–25;
 * `docs/architecture.md` § Scouts, *Form*). The file stays the truth: this
 * writes the same `.vitrine/scouts/<id>.yaml` a hand edit would, and an edit
 * rewrites only the keys the form owns, so a key it has never heard of (a
 * later beat's `cap`, a comment) survives.
 */

export type ScoutForm = {
  /** Present when editing; the file's own name. */
  id?: string | undefined;
  name: string;
  query: string;
  cadence: Scout["cadence"];
  assigned: string[];
  lane: Scout["lane"];
  /** *Also search back to*, for a new Scout only: an existing Scout's window is never moved by an edit. */
  searchBackTo: string | null;
};

// Picking a free file name reads the folder and then writes to it; two saves
// that overlapped would both see the name free. The queue is here, in the
// function, never in a caller that must remember it.
const saving = serialised();

export async function saveScout(
  deps: ScoutDeps,
  form: ScoutForm
): Promise<{ id: string; run: RunSummary | null }> {
  const { id, runAfter } = await saving(() => write(deps, form));
  // Saving an edited Query runs the Scout at once: the new text has not been
  // tried, and a wait left over from the old one must not hold it. It runs
  // outside the file queue — a broad Query pages for minutes, and holding
  // every other save and pause behind it would be a lock on the wrong thing.
  // History and `window_to` are untouched: the run opens where the last
  // clean one closed.
  return { id, run: runAfter ? await runScout(deps, id) : null };
}

async function write(
  deps: ScoutDeps,
  form: ScoutForm
): Promise<{ id: string; runAfter: boolean }> {
  const name = form.name.trim();
  const query = form.query.trim();
  if (name === "" || query === "") {
    throw new VaultError("refused", "A Scout needs a name and a Query.");
  }
  const folder = join(deps.vaultPath, SCOUTS_FOLDER);
  const { scouts } = await readScouts(deps.vaultPath);
  const names = await readdir(folder).catch(() => [] as string[]);
  const before =
    form.id === undefined ? undefined : fileOf(scouts, form.id, names);

  let doc: Document;
  let id: string;
  if (form.id === undefined) {
    id = freeId(name, names);
    doc = new Document({});
    doc.set("name", name);
    doc.set("source", { kind: "arxiv" });
    doc.set("created", deps.now().toISOString());
    if (form.searchBackTo !== null) {
      doc.set("search_back_to", form.searchBackTo);
    }
  } else {
    id = form.id;
    if (before === undefined) {
      throw new VaultError("refused", `There is no Scout named ${id}.`);
    }
    if (before.scout.source.kind === "watched") {
      // The form's Query is an arXiv Query; writing it over a page's address
      // would quietly turn the Scout into something else.
      throw new VaultError(
        "refused",
        "A Scout that watches a web page is edited in its file for now."
      );
    }
    doc = parseDocument(await readFile(join(folder, before.file), "utf8"));
    doc.set("name", name);
  }
  doc.set("cadence", form.cadence);
  doc.set("lane", form.lane);
  doc.set("assigned", form.assigned);
  if (isMap(doc.get("filter"))) doc.setIn(["filter", "query"], query);
  else doc.set("filter", { query });

  await mkdir(folder, { recursive: true });
  await writeAtomically(
    join(folder, before?.file ?? `${id}.yaml`),
    String(doc)
  );

  // A paused Scout is not looking: the edit is saved and the run waits for
  // *resume* — pausing is how a researcher retires one, and an edit must
  // not quietly undo it.
  const edited =
    before !== undefined &&
    before.scout.query !== query &&
    !before.scout.paused;
  return { id, runAfter: edited };
}

/** Pause or resume. There is no delete: a Scout owns the runs health reads (spec #447 story 25). */
export function setPaused(
  deps: ScoutDeps,
  scoutId: string,
  paused: boolean
): Promise<void> {
  return saving(async () => {
    const folder = join(deps.vaultPath, SCOUTS_FOLDER);
    const { scouts } = await readScouts(deps.vaultPath);
    const found = fileOf(
      scouts,
      scoutId,
      await readdir(folder).catch(() => [] as string[])
    );
    if (found === undefined) {
      throw new VaultError("refused", `There is no Scout named ${scoutId}.`);
    }
    const doc = parseDocument(await readFile(join(folder, found.file), "utf8"));
    if (paused) doc.set("paused", true);
    else doc.delete("paused");
    await writeAtomically(join(folder, found.file), String(doc));
  });
}

export type TriedQuery =
  | { outcome: "found"; total: number; titles: string[] }
  | { outcome: "failed"; sentence: string };

/**
 * *Try*: the Query once, with no date window, for its total and the first
 * five titles. It writes nothing and is never what Save waits on; a failure
 * is the sentence its kind has everywhere else.
 */
export async function tryQuery(
  deps: ScoutDeps,
  query: string
): Promise<TriedQuery> {
  if (query.trim() === "") {
    throw new VaultError("refused", "There is no Query to try.");
  }
  try {
    const found = await deps.arxiv.search(query.trim(), null, { limit: 5 });
    return {
      outcome: "found",
      total: found.total,
      titles: found.items.slice(0, 5).map((item) => item.title),
    };
  } catch (cause) {
    // A bug here must not be worded as an arXiv fault.
    if (!(cause instanceof ArxivError)) throw cause;
    return {
      outcome: "failed",
      sentence: faultSentence(cause.kind, cause.message, false),
    };
  }
}

/** A Scout and the file it came from: a hand-written one may end `.yml`. */
function fileOf(scouts: Scout[], id: string, names: string[]) {
  const scout = scouts.find((s) => s.id === id);
  const file = names.find((n) => n.replace(/\.ya?ml$/i, "") === id);
  return scout === undefined || file === undefined
    ? undefined
    : { scout, file };
}

function freeId(name: string, names: string[]): string {
  const taken = new Set(names.map((n) => n.replace(/\.ya?ml$/i, "")));
  const base =
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "scout";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}
