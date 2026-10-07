import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Document, isMap, parseDocument } from "yaml";
import { ArxivError } from "./arxiv.js";
import { NO_KEY, WatchedError, readWatched } from "./watched.js";
import { errorMessageWithoutPath, VaultError } from "./errors.js";
import {
  isScoutFile,
  listScoutsFolder,
  readScouts,
  readScoutFile,
  scoutIdOf,
  SCOUTS_FOLDER,
  writeScoutFile,
  type Scout,
} from "./scout-file.js";
import { faultSentence } from "./scout-health.js";
import { dueUnder } from "./scout-schedule.js";
import { runScout, type RunSummary, type ScoutDeps } from "./scouts.js";
import { serialised } from "./serialise.js";

/**
 * Making and changing a Scout without a file editor (spec #447 stories 1–25;
 * `docs/architecture.md` § Scouts, *Form*). The file stays the truth: this
 * writes the same `.vitrine/scouts/<id>.yaml` a hand edit would, and an edit
 * rewrites only the keys the form owns, so a key it has never heard of (a
 * later beat's `cap`, a comment) survives.
 */

const WEB_ADDRESS = /^https?:\/\/\S+$/i;
const ADDRESS_REFUSAL = "An address needs to start with http:// or https://.";

export type ScoutForm = {
  /** Present when editing; the file's own name. */
  id?: string | undefined;
  name: string;
  /** What it watches; a page's *Address* travels in `query`, so one field is one field (ADR 0040 d.4). */
  watching?: "arxiv" | "watched" | undefined;
  query: string;
  cadence: Scout["cadence"];
  assigned: string[];
  lane: Scout["lane"];
  /** *Also search back to*, for a new Scout only: an existing Scout's window is never moved by an edit. */
  searchBackTo: string | null;
};

// Every edit of a Scout's file reads it and writes it back: a save picks a free
// file name from the folder and then writes to it, and a pause or resume plans
// its write against the text it read. Two that overlapped would both see the
// name free, or one would write back a file without the other's change. So
// they all join this queue, and so must any later edit of the file. It is here,
// in the function, never in a caller that must remember it.
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
  const watched = form.watching === "watched";
  if (name === "" || query === "") {
    throw new VaultError(
      "refused",
      watched
        ? "A Scout needs a name and an address."
        : "A Scout needs a name and a Query."
    );
  }
  if (watched && !WEB_ADDRESS.test(query)) {
    throw new VaultError("refused", ADDRESS_REFUSAL);
  }
  const folder = join(deps.vaultPath, SCOUTS_FOLDER);
  const { scouts } = await readScouts(deps.vaultPath);
  const names = await listScoutsFolder(deps.vaultPath);
  const before =
    form.id === undefined ? undefined : fileOf(scouts, form.id, names);

  let doc: Document;
  let id: string;
  if (form.id === undefined) {
    id = freeId(name, names);
    doc = new Document({});
    doc.set("name", name);
    doc.set(
      "source",
      watched ? { kind: "watched", url: query } : { kind: "arxiv" }
    );
    doc.set("created", deps.now().toISOString());
    // A page has no date window: its first run proposes all it lists.
    if (!watched && form.searchBackTo !== null) {
      doc.set("search_back_to", form.searchBackTo);
    }
  } else {
    id = form.id;
    if (before === undefined) {
      throw new VaultError("refused", `There is no Scout named ${id}.`);
    }
    // What a saved Scout watches is fixed for now. An arXiv Query written over
    // a page's address would turn one Scout's history into another's, and a
    // different address invalidates the page hash and the structure-change test
    // that history rests on. ADR 0042 decision 5 keeps that change on the form
    // and leaves how it is made to a decision of its own; until then the
    // address is changed in the file and a save that would change it is
    // refused. A Scout Activity row saves a page's Assigned Questions through
    // here with the address it has.
    const wasWatched = before.scout.source.kind === "watched";
    if (wasWatched !== watched || (watched && query !== before.scout.query)) {
      throw new VaultError(
        "refused",
        "What a Scout watches is changed in its file for now."
      );
    }
    doc = parseDocument(await readScoutFile(deps.vaultPath, before.file));
    doc.set("name", name);
  }
  doc.set("cadence", form.cadence);
  doc.set("lane", form.lane);
  // A list is a node `doc.set` replaces whole, so setting it to what it
  // already was would drop a comment on it and the style it was written in,
  // and add the key to a file that never had one: a save that did not change a
  // key does not write it (ADR 0009). The scalars above keep their comments
  // when set to what they were, so only the list needs the check.
  if (before === undefined || !sameList(before.scout.assigned, form.assigned)) {
    doc.set("assigned", form.assigned);
  }
  if (!watched) {
    if (isMap(doc.get("filter"))) doc.setIn(["filter", "query"], query);
    else doc.set("filter", { query });
  }

  await mkdir(folder, { recursive: true }).catch((cause: unknown) => {
    throw new VaultError(
      "writeFailed",
      `Couldn't create ${SCOUTS_FOLDER}/: ${errorMessageWithoutPath(cause)}`
    );
  });
  await writeScoutFile(
    deps.vaultPath,
    before?.file ?? `${id}.yaml`,
    scoutText(doc)
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

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((item, at) => item === b[at]);

/**
 * A Scout's file as text, printed the way a person writes one. `yaml` folds a
 * plain scalar longer than 80 columns onto a second line and pads a flow list
 * (`[ a, b ]`) unless told not to: the same values in other bytes, so a write
 * that never touched a long Query, or a list written `[a, b]`, would still
 * reshape it (ADR 0009).
 */
const scoutText = (doc: Document) =>
  doc.toString({ lineWidth: 0, flowCollectionPadding: false });

/**
 * A narrow write of one Scout's file: pause and resume, for the Scout's header,
 * Loose Ends' row and Scout Activity's alike (#453, #533), and a row's cadence
 * (#520). It is queued with the form's saves and written whole, as they are: a
 * second way to write the file would be a second way to lose an edit or leave
 * half of one. The document is edited rather than re-stringified so a
 * hand-written file keeps its comments and order (ADR 0009), and a file that
 * does not parse is refused, not rewritten — `readScouts` does not list it, so
 * there is no Scout to find — because the app would be guessing at its shape.
 * `change` sets the keys the write owns and no others.
 */
function editScoutFile(
  deps: ScoutDeps,
  scoutId: string,
  change: (doc: Document, scout: Scout) => void
): Promise<void> {
  return saving(async () => {
    const { scouts } = await readScouts(deps.vaultPath);
    const found = fileOf(
      scouts,
      scoutId,
      await listScoutsFolder(deps.vaultPath)
    );
    if (found === undefined) {
      throw new VaultError("refused", `There is no Scout named ${scoutId}.`);
    }
    const doc = parseDocument(await readScoutFile(deps.vaultPath, found.file));
    change(doc, found.scout);
    await writeScoutFile(deps.vaultPath, found.file, scoutText(doc));
  });
}

/**
 * Pause or resume. There is no delete: a Scout owns the runs health reads
 * (spec #447 story 25).
 */
export function setPaused(
  deps: ScoutDeps,
  scoutId: string,
  paused: boolean
): Promise<void> {
  return editScoutFile(deps, scoutId, (doc) => {
    if (paused) doc.set("paused", true);
    else doc.delete("paused");
  });
}

/**
 * A row's cadence menu: the one key, and no other (spec #511, *Implementation
 * Decisions*). It
 * answers whether this change made the Scout due at the next check, read from
 * the Scout as the file had it, so the row can say a run is coming.
 */
export async function setCadence(
  deps: ScoutDeps,
  scoutId: string,
  cadence: Scout["cadence"]
): Promise<{ dueAtNextCheck: boolean }> {
  let dueAtNextCheck = false;
  await editScoutFile(deps, scoutId, (doc, scout) => {
    dueAtNextCheck = dueUnder(deps.queue, scout, deps.now()).includes(cadence);
    doc.set("cadence", cadence);
  });
  return { dueAtNextCheck };
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

export type TriedPage =
  | {
      outcome: "found";
      /** A feed costs no model call; a page is read by one and verified. */
      via: "feed";
      total: number;
      titles: string[];
    }
  | {
      outcome: "found";
      via: "model";
      /** What the model returned (not `verified`), of which `verified` are on the page and `dropped` are not. */
      total: number;
      verified: number;
      dropped: number;
      titles: string[];
      tokens: { input: number; output: number } | null;
      costUsd: number | null;
    }
  | { outcome: "no-key"; sentence: string }
  | { outcome: "failed"; sentence: string };

/**
 * *Try* for a page: the whole pipeline — fetch, feed or extraction,
 * verification — and nothing written, so what it shows is what the Scout
 * would find (spec #463 story 25). It reads no history: the run it asks
 * about does not exist, so the hash short-circuit has nothing to hit.
 * A missing key is not a failure; it is the one outcome that offers a way on.
 */
export async function tryPage(
  deps: ScoutDeps,
  address: string
): Promise<TriedPage> {
  const url = address.trim();
  if (!WEB_ADDRESS.test(url)) throw new VaultError("refused", ADDRESS_REFUSAL);
  try {
    const read = await readWatched(deps.watched, deps.queue, {
      id: TRY_ID,
      url,
    });
    const titles = read.items.slice(0, 5).map((item) => item.title);
    if (read.facts.model === null) {
      return { outcome: "found", via: "feed", total: read.fetched, titles };
    }
    const { usage } = read.facts;
    return {
      outcome: "found",
      via: "model",
      total: read.fetched + read.facts.unverified,
      verified: read.fetched,
      dropped: read.facts.unverified,
      titles,
      tokens:
        usage === null ? null : { input: usage.input, output: usage.output },
      costUsd: read.facts.costUsd,
    };
  } catch (cause) {
    // A bug here must not be worded as a page's fault.
    if (!(cause instanceof WatchedError)) throw cause;
    const sentence = faultSentence(cause.kind, cause.message, false, "watched");
    return cause.kind === "credentials" && cause.message === NO_KEY
      ? { outcome: "no-key", sentence }
      : { outcome: "failed", sentence };
  }
}

/** A Scout id no file can have (ids are file names): *try* is looking for no one's history. */
const TRY_ID = "\0try";

/**
 * A Scout and the file it came from: a hand-written one may end `.yml`. Only
 * the names `readScouts` takes for a Scout are candidates — a folder or a
 * file named like the id sorts ahead of `<id>.yaml` and is not it.
 */
function fileOf(scouts: Scout[], id: string, names: string[]) {
  const scout = scouts.find((s) => s.id === id);
  const file = names.find((n) => isScoutFile(n) && scoutIdOf(n) === id);
  return scout === undefined || file === undefined
    ? undefined
    : { scout, file };
}

function freeId(name: string, names: string[]): string {
  const taken = new Set(names.map(scoutIdOf));
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
