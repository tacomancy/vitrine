import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  Document,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  stringify,
} from "yaml";
import { ArxivError } from "./arxiv.js";
import {
  openAlexId,
  OpenAlexError,
  SEARCH_FILTER,
  type NameResult,
  type OpenAlexClient,
} from "./openalex.js";
import { costUsd } from "./model-prices.js";
import {
  NO_KEY,
  WatchedError,
  readWatched,
  type Arrival,
  type Read,
} from "./watched.js";
import { errorMessageWithoutPath, VaultError } from "./errors.js";
import {
  isScoutFile,
  listScoutsFolder,
  parseQueueNumber,
  queueNumberProblem,
  QUEUE_KEYS,
  pagesOf,
  readScouts,
  readScoutFile,
  scoutIdOf,
  takenIdOf,
  SCOUTS_FOLDER,
  VENUE_ID,
  writeScoutFile,
  type Scout,
  type Venue,
} from "./scout-file.js";
import { faultSentence, lastWindow } from "./scout-health.js";
import { dueUnder } from "./scout-schedule.js";
import {
  compileTagsOrRefuse,
  runScout,
  type RunSummary,
  type ScoutDeps,
} from "./scouts.js";
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
  /** What it watches. */
  watching?: "arxiv" | "openalex" | "watched" | undefined;
  query: string;
  /**
   * A Watched Scout's *Addresses*, in the order the form lists them (ADR 0056
   * decision 13). Absent, `query` is its one page, as every save sent before
   * a Scout could have several.
   */
  urls?: string[] | undefined;
  /**
   * The Filter as Tags, as written (spec #678): present and non-empty makes it
   * a Tag Filter, and then `query` must be empty — a Scout has one or the
   * other. Absent leaves a saved Scout's Filter as it is, which is how a Scout
   * Activity row saves a Lane without knowing which Filter it holds; empty
   * with a `query` is the switch back to a Query.
   */
  tags?: string[] | undefined;
  /**
   * An OpenAlex Scout's venue allowlist (ADR 0051 decision 9). Absent leaves
   * the file's `filter.venues` alone, as a Scout Activity row's save must;
   * empty takes the key away, which is no allowlist.
   */
  venues?: Venue[] | undefined;
  cadence: Scout["cadence"];
  assigned: string[];
  lane: Scout["lane"];
  /** *Also search back to*, for a new Scout only: an existing Scout's window is never moved by an edit. */
  searchBackTo: string | null;
  /**
   * *Queue behaviour*, as the text the form holds. Absent leaves the file's
   * key alone (a Scout Activity row saves without them); empty or null takes
   * the key away, which is the default; anything else must be a whole number
   * of 1 or more or the save is refused by the field's file name.
   */
  cap?: string | null | undefined;
  reviewDays?: string | null | undefined;
  skimDays?: string | null | undefined;
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
  const { scouts } = await readScouts(deps.vaultPath);
  const names = await listScoutsFolder(deps.vaultPath);
  const before =
    form.id === undefined ? undefined : fileOf(scouts, form.id, names);
  const given = [...new Set((form.tags ?? []).map((t) => t.trim()))].filter(
    (t) => t !== ""
  );
  if (given.length > 0 && watched) {
    throw new VaultError("refused", "Tags don't apply to a Watched page.");
  }
  if (given.length > 0 && query !== "") {
    throw new VaultError("refused", "A Scout has Tags or a Query, never both.");
  }
  // A Tag Filter has no Query to type (spec #678): a save that says nothing of
  // the Filter (a Scout Activity row's Lane, say) leaves `filter.tags` alone.
  const saysNothingOfFilter = form.tags === undefined && query === "";
  const tags =
    given.length > 0
      ? given
      : saysNothingOfFilter
        ? before?.scout.tags
        : undefined;
  const pages = watched ? (form.urls ?? [form.query]).map((u) => u.trim()) : [];
  const nothingWatched = watched
    ? pages.every((page) => page === "")
    : query === "" && tags === undefined;
  if (name === "" || nothingWatched) {
    throw new VaultError(
      "refused",
      watched
        ? "A Scout needs a name and an address."
        : "A Scout needs a name and a Query."
    );
  }
  if (pages.some((page) => !WEB_ADDRESS.test(page))) {
    throw new VaultError("refused", ADDRESS_REFUSAL);
  }
  // A page listed twice would be read twice in a check (ADR 0039 d.7); page
  // identity is the trimmed string (ADR 0043 d.3).
  const twice = pages.find((page, at) => pages.indexOf(page) !== at);
  if (twice !== undefined) {
    throw new VaultError(
      "refused",
      `${twice} is listed twice. A Scout reads each page once.`
    );
  }
  // Only a Tag this save adds is refused: a Tag already in the file whose
  // Lexicon later emptied must not trap the Scout's other edits (its run
  // fails by name instead).
  const added = given.filter((t) => !(before?.scout.tags ?? []).includes(t));
  if (added.length > 0) {
    await compileTagsOrRefuse(
      deps,
      added,
      form.watching === "openalex" ? "openalex" : "arxiv"
    );
  }
  const venues = checkedVenues(form.venues, form.watching);
  const queueEdits = queueBehaviour(form);
  const folder = join(deps.vaultPath, SCOUTS_FOLDER);

  let doc: Document;
  let id: string;
  if (form.id === undefined) {
    id = freeId(name, names);
    doc = new Document({});
    doc.set("name", name);
    doc.set(
      "source",
      !watched
        ? { kind: form.watching === "openalex" ? "openalex" : "arxiv" }
        : pages.length === 1
          ? { kind: "watched", url: pages[0] }
          : { kind: "watched", urls: pages }
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
    // A saved Scout keeps its kind of source: the file's keys differ in shape
    // (`filter.query` and a date window against `source.url`), so a flip would
    // turn one Scout's history into another's. A changed page is the same
    // Scout pointed elsewhere (ADR 0043 d.1) and is written below. A Scout
    // Activity row saves a page's Assigned Questions through here with the
    // address it has.
    const wasWatched = before.scout.source.kind === "watched";
    const wasOpenAlex = before.scout.source.kind === "openalex";
    if (
      wasWatched !== watched ||
      wasOpenAlex !== (form.watching === "openalex")
    ) {
      throw new VaultError(
        "refused",
        `A Scout keeps its kind of source. To watch ${watched ? "a page" : form.watching === "openalex" ? "OpenAlex" : "arXiv"} instead, make a new Scout.`
      );
    }
    doc = parseDocument(await readScoutFile(deps.vaultPath, before.file));
    doc.set("name", name);
    if (watched) writePages(doc, before.scout, pages);
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
  for (const [key, value] of queueEdits) {
    if (value === null) doc.delete(key);
    else doc.set(key, value);
  }
  const venuesChanged =
    venues !== undefined && !sameVenues(before?.scout.venues ?? [], venues);
  // A rename or a reorder rewrites the file but asks the same venues, so it
  // does not spend a run.
  const askedVenuesChanged =
    venues !== undefined && !sameIds(before?.scout.venues ?? [], venues);
  if (!watched) {
    writeFilter(
      doc,
      query,
      tags,
      before?.scout.tags,
      venuesChanged ? venues : undefined
    );
    if (venuesChanged) writeVenues(doc, venues);
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
  // A page is never run by a save: its first read may spend (ADR 0040 d.5).
  // A changed allowlist changes what is asked as a changed Query does.
  const edited =
    before !== undefined &&
    !watched &&
    (askedVenuesChanged ||
      (tags === undefined
        ? before.scout.tags !== undefined || before.scout.query !== query
        : before.scout.tags === undefined ||
          !sameList(before.scout.tags, tags))) &&
    !before.scout.paused;
  return { id, runAfter: edited };
}

/**
 * The form's *Addresses* written to the file (ADR 0056 decision 12): `url:`
 * for one page and `urls:` for several, in the place of the key the file had,
 * so a save never gives a file both and moves nothing around it. Pages saved
 * as they were are not written at all, so a one-page Scout keeps `url:` and a
 * list keeps the style and comments it was written with (ADR 0009).
 */
function writePages(doc: Document, scout: Scout, pages: string[]) {
  if (sameList(pagesOf(scout), pages)) return;
  const source = doc.get("source");
  const pair = isMap(source)
    ? source.items.find(
        (p) =>
          isScalar(p.key) && (p.key.value === "url" || p.key.value === "urls")
      )
    : undefined;
  // `readScout` has read this file as a Watched Scout, so it holds one of them.
  if (pair === undefined || !isScalar(pair.key)) {
    throw new VaultError("refused", "This Scout's file names no page.");
  }
  const was = pair.value;
  // A comment written beside or above a page is the researcher's, about that
  // page, so it stays with the page wherever the page now sits; an address
  // edited in its place keeps the comments of its line, as a hand edit would.
  const before = (isSeq(was) ? was.items : [was]).filter(isScalar);
  const next = doc.createNode(pages.length === 1 ? pages[0] : pages);
  (isSeq(next) ? next.items : [next]).forEach((entry, at) => {
    if (!isScalar(entry)) return;
    const own = before.find((b) => String(b.value).trim() === entry.value);
    const replaced = before[at];
    let from = own;
    if (
      from === undefined &&
      replaced !== undefined &&
      !pages.includes(String(replaced.value).trim())
    ) {
      from = replaced;
    }
    entry.comment = from?.comment ?? null;
    entry.commentBefore = from?.commentBefore ?? null;
  });
  // A lone page's comment above it is drawn above its key, which is where
  // `url:` would have it; under the key it would break the value's line.
  if (isScalar(next) && next.commentBefore) {
    pair.key.commentBefore = [pair.key.commentBefore, next.commentBefore]
      .filter(Boolean)
      .join("\n");
    next.commentBefore = null;
  }
  pair.key.value = pages.length === 1 ? "url" : "urls";
  pair.value = next;
}

/**
 * One of `filter.query` and `filter.tags`, never both. A key the save did not
 * change is not written, so its comment and the style it was written in stay
 * (ADR 0009); the other key of the pair goes, which is what a switch is.
 */
function writeFilter(
  doc: Document,
  query: string,
  tags: string[] | undefined,
  was: string[] | undefined,
  venues?: Venue[]
) {
  const filter = doc.get("filter");
  if (!isMap(filter)) {
    // A filter made here is a plain object, not yet a node `writeVenues` can
    // edit, so the allowlist (new Scouts only get here with one) rides along.
    doc.set("filter", {
      ...(tags === undefined ? { query } : { tags }),
      ...(venues === undefined || venues.length === 0 ? {} : { venues }),
    });
  } else if (tags === undefined) {
    filter.delete("tags");
    filter.set("query", query);
  } else if (was === undefined || !sameList(was, tags)) {
    filter.delete("query");
    filter.set("tags", tags);
  }
}

/**
 * The allowlist the form sent, refused by name where it cannot be sent: only
 * an OpenAlex Scout has one, and an ID goes into a request's filter as it is.
 */
function checkedVenues(
  venues: Venue[] | undefined,
  watching: ScoutForm["watching"]
): Venue[] | undefined {
  if (venues === undefined || venues.length === 0) return venues;
  if (watching !== "openalex") {
    throw new VaultError(
      "refused",
      "Only an OpenAlex Scout has a venue allowlist."
    );
  }
  const seen = new Set<string>();
  const checked: Venue[] = [];
  for (const venue of venues) {
    const id = openAlexId(venue.id);
    if (id === null || !VENUE_ID.test(id) || venue.name.trim() === "") {
      throw new VaultError(
        "refused",
        `A venue needs an OpenAlex id like S123 and a name (${venue.name || venue.id}).`
      );
    }
    if (!seen.has(id)) checked.push({ id, name: venue.name.trim() });
    seen.add(id);
  }
  return checked;
}

const sameVenues = (a: readonly Venue[], b: readonly Venue[]) =>
  a.length === b.length &&
  a.every((v, at) => v.id === b[at]?.id && v.name === b[at]?.name);

const sameIds = (a: readonly Venue[], b: readonly Venue[]) =>
  a.length === b.length && a.every((v) => b.some((w) => w.id === v.id));

/** `filter.venues` written whole when it changed and not otherwise, so a comment on it survives a save that left it alone (ADR 0009); empty takes the key away. */
function writeVenues(doc: Document, venues: Venue[]) {
  const filter = doc.get("filter");
  // `writeFilter` wrote a new filter with the allowlist in it.
  if (!isMap(filter)) return;
  if (venues.length === 0) filter.delete("venues");
  else filter.set("venues", venues);
}

/**
 * What the form's Queue behaviour text says to do to each key, checked before
 * anything is written so a bad value refuses the whole save and names itself.
 */
function queueBehaviour(form: ScoutForm): Array<[string, number | null]> {
  const edits: Array<[string, number | null]> = [];
  for (const [field, key] of Object.entries(QUEUE_KEYS)) {
    const text = form[field as keyof typeof QUEUE_KEYS];
    if (text === undefined) continue;
    if (text === null || text.trim() === "") {
      edits.push([key, null]);
      continue;
    }
    const n = parseQueueNumber(text);
    if (n === null) {
      throw new VaultError("refused", `${queueNumberProblem(key)}.`);
    }
    edits.push([key, n]);
  }
  return edits;
}

// Order-sensitive on purpose: a reordered list is a written change to the file,
// and the Terms of each Tag are OR'd in list order.
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
 * Decisions*). It answers whether this change made the Scout due at the next
 * check, read from the Scout as the file had it, so the row can say a run is
 * coming.
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

/**
 * Drop a Scout, or restore one (ADR 0042 decisions 1 and 9): the `dropped` key
 * in its file set or cleared, and nothing else written. The same queued, atomic
 * edit as a pause, so one that overlaps a save loses neither.
 */
export function setDropped(
  deps: ScoutDeps,
  scoutId: string,
  dropped: boolean
): Promise<void> {
  return saving(async () => {
    const read = await readScouts(deps.vaultPath);
    // An erased Scout has no file to change: drop or restore, the answer is
    // the reason, said beside the name (ADR 0053 decision 6).
    const gone = read.erased.find((t) => t.id === scoutId);
    if (gone !== undefined) {
      throw new VaultError(
        "refused",
        `${gone.name} was erased and cannot be ${dropped ? "dropped" : "restored"}.`
      );
    }
    // A dropped Scout is a file too, and restoring one has to find it.
    const found = fileOf(
      [...read.scouts, ...read.dropped],
      scoutId,
      await listScoutsFolder(deps.vaultPath)
    );
    if (found === undefined) {
      throw new VaultError("refused", `There is no Scout named ${scoutId}.`);
    }
    // Already as asked: a second click, or a restore of a Scout that never
    // left, writes nothing, and a drop keeps the date of the first.
    if ((found.scout.dropped !== null) === dropped) return;
    const doc = parseDocument(await readScoutFile(deps.vaultPath, found.file));
    if (dropped) doc.set("dropped", deps.now().toISOString());
    else doc.delete("dropped");
    await writeScoutFile(deps.vaultPath, found.file, scoutText(doc));
  });
}

/**
 * Erase a dropped Scout (ADR 0053 decision 6): its file removed and a tombstone
 * — its name, nothing else — written in its place, so every record that names
 * the Scout by id keeps resolving. Nothing else is touched: no `triage` row, no
 * run, no stub. The queue is the one `setDropped` and the form's save join, so
 * an erase overlapping a restore of the same Scout cannot interleave; the
 * preconditions are read inside it for the same reason. Pending or deferred
 * Proposals refuse the erase rather than being rejected for the researcher
 * (ADR 0042 decision 1), and every one of them is counted by an Appearance of
 * the Scout, in either lane, since each is on the Queue under its name.
 */
export function eraseScout(deps: ScoutDeps, scoutId: string): Promise<void> {
  return saving(async () => {
    const read = await readScouts(deps.vaultPath);
    const gone = read.erased.find((t) => t.id === scoutId);
    if (gone !== undefined) {
      throw new VaultError("refused", `${gone.name} was already erased.`);
    }
    const names = await listScoutsFolder(deps.vaultPath);
    const live = fileOf(read.scouts, scoutId, names);
    if (live !== undefined) {
      throw new VaultError(
        "refused",
        `${live.scout.name} is not dropped. Drop it first; only a dropped Scout can be erased.`
      );
    }
    const found = fileOf(read.dropped, scoutId, names);
    if (found === undefined) {
      throw new VaultError("refused", `There is no Scout named ${scoutId}.`);
    }
    const waiting = proposalsWaitingOn(deps, scoutId);
    const total = waiting.pending + waiting.deferred;
    if (total > 0) {
      // A deferred Proposal comes back when the Scout next looks, so the way
      // out of one is a restore as well as a triage.
      const way =
        waiting.deferred > 0
          ? ", or restore the Scout so it can look again,"
          : "";
      throw new VaultError(
        "refused",
        `${found.scout.name} still has ${waitingSentence(waiting)} in the Queue. Triage ${total === 1 ? "it" : "them"}${way} before erasing.`
      );
    }
    // The tombstone first: a write that fails here leaves the file exactly as
    // it was, and a Scout file beside a tombstone reads as the Scout.
    const tombstone = `${scoutId}.erased`;
    await writeScoutFile(
      deps.vaultPath,
      tombstone,
      stringify({ name: found.scout.name })
    );
    try {
      await rm(join(deps.vaultPath, SCOUTS_FOLDER, found.file));
    } catch (cause) {
      // Half done is worse than not done: take the tombstone back, so the
      // dropped Scout is still on its line to try again.
      await rm(join(deps.vaultPath, SCOUTS_FOLDER, tombstone), {
        force: true,
      }).catch(() => undefined);
      throw new VaultError(
        "writeFailed",
        `Couldn't remove ${SCOUTS_FOLDER}/${found.file}: ${errorMessageWithoutPath(cause)}`
      );
    }
  });
}

function proposalsWaitingOn(deps: ScoutDeps, scoutId: string) {
  const counts = deps.queue
    .prepare(
      `SELECT p.state AS state, COUNT(DISTINCT p.id) AS n
         FROM proposals p JOIN appearances a ON a.proposal_id = p.id
        WHERE a.scout_id = ? AND p.state IN ('pending', 'deferred')
        GROUP BY p.state`
    )
    .all(scoutId) as Array<{ state: string; n: number }>;
  const of = (state: string) => counts.find((c) => c.state === state)?.n ?? 0;
  return { pending: of("pending"), deferred: of("deferred") };
}

function waitingSentence(w: { pending: number; deferred: number }): string {
  const say = (n: number, state: string) =>
    `${n} ${state} Proposal${n === 1 ? "" : "s"}`;
  return [
    w.pending > 0 ? say(w.pending, "pending") : null,
    w.deferred > 0 ? say(w.deferred, "deferred") : null,
  ]
    .filter((part) => part !== null)
    .join(" and ");
}

export type NamesFound =
  | {
      outcome: "found";
      results: NameResult[];
      creditsLeft: number | null;
    }
  | { outcome: "failed"; sentence: string };

/**
 * The name search behind a venue or publisher rule (ADR 0051 decision 9). A
 * failed or spent search is said as one with the fault's own sentence, never
 * an empty list: nothing found and nothing asked must not look alike.
 */
export async function searchNames(
  client: OpenAlexClient,
  kind: "venue" | "publisher",
  name: string
): Promise<NamesFound> {
  if (name.trim() === "") {
    throw new VaultError("refused", "There is no name to search for.");
  }
  try {
    const found = await client.searchNames(kind, name.trim());
    return { outcome: "found", ...found };
  } catch (cause) {
    if (!(cause instanceof OpenAlexError)) throw cause;
    return {
      outcome: "failed",
      sentence: faultSentence(cause.kind, cause.message, false, "openalex"),
    };
  }
}

export type TriedQuery =
  | {
      outcome: "found";
      total: number;
      titles: string[];
      /** OpenAlex only: the shared daily budget as its answer stated it, null when it did not. A keyless budget is shared by IP (ADR 0051 decision 5), so *try* shows what it left. */
      creditsLeft?: number | null;
    }
  | { outcome: "failed"; sentence: string };

/**
 * *Try*: the Query once, with no date window, for its total and the first
 * five titles. It writes nothing and is never what Save waits on; a failure
 * is the sentence its kind has everywhere else.
 */
export async function tryQuery(
  deps: ScoutDeps,
  query: string,
  source: "arxiv" | "openalex" = "arxiv",
  venues: readonly Venue[] = []
): Promise<TriedQuery> {
  if (query.trim() === "") {
    throw new VaultError("refused", "There is no Query to try.");
  }
  if (source === "openalex") {
    try {
      const found = await deps.openalex.searchWorks(query.trim(), null, {
        limit: 5,
        venues: checkedVenues([...venues], "openalex")?.map((v) => v.id) ?? [],
      });
      return {
        outcome: "found",
        total: found.total,
        titles: found.works.slice(0, 5).map((work) => work.title),
        creditsLeft: found.creditsLeft,
      };
    } catch (cause) {
      if (!(cause instanceof OpenAlexError)) throw cause;
      return {
        outcome: "failed",
        sentence: faultSentence(cause.kind, cause.message, false, "openalex"),
      };
    }
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

/**
 * *Try* for Tags: what a run would ask now, once and with no window, so the
 * form shows what a Query shows. A Tag with nothing to compile is refused by
 * name, as the run refuses it.
 */
export async function tryTags(
  deps: ScoutDeps,
  tags: readonly string[],
  source: "arxiv" | "openalex" = "arxiv",
  venues: readonly Venue[] = []
): Promise<TriedQuery> {
  if (tags.length === 0) {
    throw new VaultError("refused", "There are no Tags to try.");
  }
  const compiled = await compileTagsOrRefuse(deps, tags, source);
  // The run sends the search part and adds its own filters (`readOpenAlex`).
  return tryQuery(
    deps,
    source === "openalex" ? compiled.slice(SEARCH_FILTER.length) : compiled,
    source,
    venues
  );
}

export type TriedWindow =
  | {
      outcome: "found";
      /** `totalResults` for the edited Query over the window. */
      would: number;
      /** What the last completed run fetched over the same window. */
      fetched: number;
      from: string;
      to: string;
    }
  | { outcome: "failed"; sentence: string };

/**
 * *Try over the last run's window* (ADR 0042 decision 5): the edited Query
 * over the window of the last completed run, so an edit's effect is seen
 * before it is saved. It writes nothing. A comparison that could not be made
 * is the Scout's own fault sentence and carries no figures, so it can never
 * read as *no difference*.
 */
export async function tryWindow(
  deps: ScoutDeps,
  scoutId: string,
  query: string
): Promise<TriedWindow> {
  if (query.trim() === "") {
    throw new VaultError("refused", "There is no Query to try.");
  }
  const { scouts } = await readScouts(deps.vaultPath);
  const scout = scouts.find((s) => s.id === scoutId);
  if (scout === undefined) {
    throw new VaultError("refused", `There is no Scout named ${scoutId}.`);
  }
  if (scout.source.kind !== "arxiv") {
    throw new VaultError("refused", "Only an arXiv Scout has a Query to try.");
  }
  const window = lastWindow(deps.queue, scoutId);
  if (window === null) {
    throw new VaultError(
      "refused",
      "This Scout has not completed a run, so there is no window to try over."
    );
  }
  try {
    const found = await deps.arxiv.search(
      query.trim(),
      { from: new Date(window.from), to: new Date(window.to) },
      { limit: 1 }
    );
    return {
      outcome: "found",
      would: found.total,
      fetched: window.fetched,
      from: window.from,
      to: window.to,
    };
  } catch (cause) {
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
      /** The new items whose Item page *try* read, filled from it. */
      cards: TriedCard[];
      /**
       * What reading every new item's Item page would cost, at the mean of
       * what `cards` cost (#891); null when no page was read to measure, or
       * the model's price is not known.
       */
      projection: { costUsd: number; itemPages: number } | null;
      /** Item pages *try* asked for that could not be fetched, said so a sample of none is not silent. */
      itemPagesUnfetched: number;
    }
  | { outcome: "no-key"; sentence: string }
  | { outcome: "failed"; sentence: string };

export type TriedCard = Pick<
  Arrival,
  "title" | "url" | "authors" | "published" | "venue" | "abstract"
>;

/** How many Item pages *try* reads: enough to measure a page's cost, few enough to be quick. */
export const TRY_ITEM_PAGES = 3;

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
    const read = await readWatched(
      deps.watched,
      deps.queue,
      { id: TRY_ID, url },
      { itemPages: TRY_ITEM_PAGES }
    );
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
      cards: (read.itemPageSample?.read ?? []).map(
        ({ title, url, authors, published, venue, abstract }) => ({
          title,
          url,
          authors,
          published,
          venue,
          abstract,
        })
      ),
      projection: projected(read),
      itemPagesUnfetched: read.facts.itemPagesUnread,
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

/**
 * The mean of what *try*'s fetched Item pages cost, a page that declared
 * everything at nothing, times every new item the listing showed: the first look reads
 * them all, past the ceiling over later runs (ADR 0055 decision 2). It is a
 * measurement, so with no page read there is nothing to project from.
 */
function projected(read: Read): { costUsd: number; itemPages: number } | null {
  const pages = read.itemPageSample;
  const model = read.facts.model;
  if (pages === undefined || pages.fetched === 0 || model === null) {
    return null;
  }
  // Priced even when nothing was spent: a model with no known price
  // projects nothing, never a free first look.
  const spent = costUsd(
    model,
    pages.usage ?? { input: 0, output: 0, cacheRead: 0 }
  );
  if (spent === null) return null;
  return {
    costUsd: (spent / pages.fetched) * pages.owed,
    itemPages: pages.owed,
  };
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
  const taken = new Set(names.map(takenIdOf));
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
