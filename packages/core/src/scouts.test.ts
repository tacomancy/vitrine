import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  escapeThirdParty,
  type Accepted,
  type Card,
  type RunSummary,
} from "./scouts.js";
import type { Scout, UnreadableScout } from "./scout-file.js";
import type { Group } from "./triage.js";
import {
  closeCores,
  core,
  fixtureCopy,
  fixtures,
  urlOf,
  virtualClock,
} from "./test-core.js";

afterEach(closeCores);

// The tracer for beat 6 (#448): a Scout written by hand as a file in the
// vault's app folder is run with *Run now*, arXiv answers, its papers arrive
// as Proposals, and accepting one writes a Source stub. Driven through the
// router on a temp vault with arXiv's own Atom recorded under
// `fixtures/arxiv`; the stub is asserted as bytes because Obsidian is its
// other reader.

const NOW = new Date("2026-09-30T12:34:00Z");
const QUESTION = "rq2b7x9mk4";
const QUESTION_PAGE =
  "questions/Is the overnight benefit consolidation or encoding (RQ).md";

const atom = (name: string) =>
  readFile(join(fixtures, "arxiv", `${name}.xml`), "utf8");

const reply = (body: string, status = 200) => new Response(body, { status });

/** A Scout file as someone would write it by hand. */
const scoutYaml = (over: Record<string, string> = {}) =>
  Object.entries({
    name: "Sleep and memory",
    cadence: "daily",
    lane: "review",
    created: "2026-09-20T00:00:00Z",
    ...over,
  })
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n") +
  `\nfilter:\n  query: ${over["query"] ?? "all:sleep AND all:memory"}\nassigned:\n  - ${QUESTION}\n`;

type Answer = (url: URL) => Response | Promise<Response>;

async function opened(
  answer: Answer,
  scouts: Record<string, string> = { "sleep.yaml": scoutYaml() }
) {
  const vault = await fixtureCopy("obsidian-vault");
  for (const [file, text] of Object.entries(scouts)) {
    const path = join(vault, ".vitrine/scouts", file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  }
  const requests: URL[] = [];
  const clock = virtualClock();
  const c = await core({
    now: () => NOW,
    arxiv: {
      clock,
      fetch: async (input) => {
        const url = urlOf(input);
        requests.push(url);
        return answer(url);
      },
    },
  });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const db = () =>
    new DatabaseSync(join(vault, ".vitrine/queue.sqlite"), { readOnly: true });
  const rows = <T>(sql: string): T[] => {
    const handle = db();
    try {
      return handle.prepare(sql).all() as T[];
    } finally {
      handle.close();
    }
  };
  return {
    vault,
    c,
    requests,
    clock,
    rows,
    list: async () => {
      const r = await c.query<{
        scouts: Scout[];
        unreadable: UnreadableScout[];
      }>("scouts.list");
      expect(r.error).toBeUndefined();
      return r.result!.data;
    },
    run: async (scoutId = "sleep") => {
      const r = await c.mutate<RunSummary>("scouts.runNow", { scoutId });
      expect(r.error).toBeUndefined();
      return r.result!.data;
    },
    cards: async () => {
      const r = await c.query<Card[]>("scouts.queue");
      expect(r.error).toBeUndefined();
      return r.result!.data;
    },
    accept: async (proposalId: number) => {
      const r = await c.mutate<Accepted>("scouts.accept", { proposalId });
      expect(r.error).toBeUndefined();
      return r.result!.data;
    },
    groups: async () => {
      const r = await c.query<Group[]>("scouts.groups");
      expect(r.error).toBeUndefined();
      return r.result!.data;
    },
    /** A triage act by name; the error, if the core refused it. */
    act: async (
      name: "reject" | "defer" | "undo" | "rejectRun",
      input: { proposalId: number } | { runId: number }
    ) => (await c.mutate(`scouts.${name}`, input)).error?.message,
    read: (path: string) => readFile(join(vault, path), "utf8"),
  };
}

const serving =
  (name: string): Answer =>
  async () =>
    reply(await atom(name));

describe("a hand-written Scout", () => {
  it("is read as found: name, Query, cadence, Assigned Questions and starting Lane", async () => {
    const c = await opened(serving("empty"));

    expect((await c.list()).scouts).toEqual([
      {
        id: "sleep",
        name: "Sleep and memory",
        query: "all:sleep AND all:memory",
        cadence: "daily",
        assigned: [QUESTION],
        lane: "review",
        paused: false,
        created: "2026-09-20T00:00:00.000Z",
        searchBackTo: null,
      },
    ]);
  });

  it("honours a hand edit on the next read, and on the next run", async () => {
    const c = await opened(serving("empty"));
    await c.run();

    await writeFile(
      join(c.vault, ".vitrine/scouts/sleep.yaml"),
      scoutYaml({ name: "Sleep, edited", query: "cat:q-bio.NC" })
    );
    await c.run();

    expect((await c.list()).scouts[0]?.name).toBe("Sleep, edited");
    expect(c.requests.at(-1)!.searchParams.get("search_query")).toMatch(
      /^\(cat:q-bio\.NC\) AND submittedDate:/
    );
  });

  it("is listed by name, with a sentence, when it does not parse", async () => {
    const c = await opened(serving("empty"), {
      "sleep.yaml": scoutYaml(),
      "broken.yaml": "name: Broken\nfilter: [unclosed\n",
    });

    const { scouts, unreadable } = await c.list();

    expect(scouts.map((s) => s.id)).toEqual(["sleep"]);
    expect(unreadable).toEqual([
      {
        file: "broken.yaml",
        sentence: expect.stringMatching(
          /^This file could not be read: line \d+ is not valid YAML\.$/
        ) as string,
      },
    ]);
  });
});

describe("Run now", () => {
  it("sends the wrapped Query from the Scout's creation time to now", async () => {
    const c = await opened(serving("empty"));

    await c.run();

    expect(c.requests[0]!.searchParams.get("search_query")).toBe(
      "(all:sleep AND all:memory) AND submittedDate:[202609200000 TO 202609301234]"
    );
  });

  it("opens the next window where the last clean run's closed, and a failed run does not advance it", async () => {
    let status = 200;
    const c = await opened(async () => reply(await atom("empty"), status));
    await c.run();
    status = 503;
    await c.run();
    status = 200;
    await c.run();

    const windows = c.requests.map(
      (r) => r.searchParams.get("search_query")!.match(/\[(\d+) TO/)![1]
    );
    // Run 1 opens at creation; run 2 (failed) and run 3 both open where run 1 closed.
    expect(windows).toEqual(["202609200000", "202609301234", "202609301234"]);
  });

  it("starts the first window at *search back to* and marks what it finds Retroactive", async () => {
    const c = await opened(serving("normal"), {
      "sleep.yaml": scoutYaml({ search_back_to: "2026-07-01" }),
    });

    const run = await c.run();

    expect(c.requests[0]!.searchParams.get("search_query")).toContain(
      "submittedDate:[202607010000 TO 202609301234]"
    );
    expect(run.new).toBe(2);
    expect((await c.cards()).every((card) => card.retroactive)).toBe(true);
    expect(c.rows("SELECT retroactive FROM scout_runs")).toEqual([
      { retroactive: 1 },
    ]);
  });

  it("makes a Proposal of every paper, newest first seen first, saying what is missing", async () => {
    const c = await opened(serving("normal"));

    const run = await c.run();
    const cards = await c.cards();

    expect(run).toMatchObject({
      outcome: "ok",
      fetched: 2,
      new: 2,
      held: 0,
      truncated: 0,
    });
    // Fetched oldest first, so the later submission is the newer card.
    expect(cards.map((card) => card.title)).toEqual([
      "Slow Oscillations Reconsidered",
      "Probing the Overnight Benefit: Consolidation or Encoding?",
    ]);
    expect(cards[0]).toMatchObject({
      authors: ["Ana van der Meer"],
      venue: null,
      doi: null,
      lane: "review",
      retroactive: false,
      url: "http://arxiv.org/abs/2609.05678v1",
    });
    expect(cards[1]).toMatchObject({
      venue: "Journal of Sleep Research 12 (2026) 1-9",
      doi: "10.1000/xyz123",
    });
    expect(Object.keys(cards[0]!)).not.toContain("keywords");
    // Why it is here: the Scout and the Questions it is assigned to.
    expect(cards[0]!.scouts).toEqual([
      {
        id: "sleep",
        name: "Sleep and memory",
        assigned: [
          {
            id: QUESTION,
            name: "Is the overnight retention benefit attributable to consolidation, or to encoding strength at learning?",
          },
        ],
      },
    ]);
  });

  it("records a run that found nothing as a clean one, not a failure", async () => {
    const c = await opened(serving("empty"));

    expect(await c.run()).toMatchObject({ outcome: "ok", fetched: 0, new: 0 });
    expect(await c.cards()).toEqual([]);
  });

  it("raises scoutFinished for a failed run as it does for a clean one", async () => {
    const c = await opened(serving("error"));
    const events = await c.c.events();

    const run = await c.run();
    const event = await events.next("scoutFinished");

    expect(event).toEqual({
      type: "scoutFinished",
      scoutId: "sleep",
      runId: run.runId,
    });
    events.close();
  });

  it("takes a feed of one error entry as a parse failure and proposes nothing", async () => {
    const c = await opened(serving("error"));

    const run = await c.run();

    expect(run).toMatchObject({
      outcome: "failed",
      errorKind: "parse",
      new: 0,
    });
    expect(await c.cards()).toEqual([]);
    expect(c.rows("SELECT outcome, error_kind FROM scout_runs")).toEqual([
      { outcome: "failed", error_kind: "parse" },
    ]);
  });

  it.each([
    [429, "rate_limited"],
    [503, "http"],
  ])("records HTTP %i as %s", async (status, kind) => {
    const c = await opened(() => reply("", status));

    expect(await c.run()).toMatchObject({ outcome: "failed", errorKind: kind });
  });

  it("stops at 500 and records how many more matched", async () => {
    const c = await opened((url) => {
      const start = Number(url.searchParams.get("start"));
      const entries = Array.from({ length: 100 }, (_, i) => {
        const id = `2609.${String(start + i).padStart(5, "0")}`;
        return `<entry><id>http://arxiv.org/abs/${id}v1</id><published>2026-09-2${(start / 100) % 10}T00:00:00Z</published><title>Paper ${id}</title><summary>s</summary><author><name>A B</name></author><link href="http://arxiv.org/abs/${id}v1" rel="alternate"/></entry>`;
      }).join("");
      return reply(
        `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="x"><opensearch:totalResults>730</opensearch:totalResults>${entries}</feed>`
      );
    });

    const run = await c.run();

    expect(run).toMatchObject({
      outcome: "ok",
      fetched: 500,
      new: 500,
      truncated: 230,
    });
    expect(c.rows("SELECT truncated FROM scout_runs")).toEqual([
      { truncated: 230 },
    ]);
    // Five pages under the ToU's gap: four sleeps of three seconds.
    expect(c.clock.slept).toEqual([3000, 3000, 3000, 3000]);
  });

  it("shares one connection between Scouts: their requests are three seconds apart", async () => {
    const c = await opened(serving("empty"), {
      "a.yaml": scoutYaml({ name: "A" }),
      "b.yaml": scoutYaml({ name: "B" }),
    });

    await Promise.all([c.run("a"), c.run("b")]);

    expect(c.clock.slept).toEqual([3000]);
  });
});

describe("one paper, however often it is found", () => {
  it("is a new Appearance on the same card when a revised version arrives", async () => {
    let feed = "normal";
    const c = await opened(async () => reply(await atom(feed)));
    await c.run();
    feed = "revised";
    const second = await c.run();

    expect(second).toMatchObject({ outcome: "ok", fetched: 1, new: 0 });
    const cards = await c.cards();
    expect(cards).toHaveLength(2);
    expect(
      c
        .rows<{ url: string }>("SELECT url FROM appearances ORDER BY rowid")
        .map((a) => a.url)
    ).toEqual([
      "http://arxiv.org/abs/2609.01234v1",
      "http://arxiv.org/abs/2609.05678v1",
      "http://arxiv.org/abs/2609.01234v2",
    ]);
  });

  it("is not a second Appearance when the same version is found again", async () => {
    const c = await opened(serving("normal"));
    await c.run();
    await c.run();

    expect(c.rows("SELECT * FROM appearances")).toHaveLength(2);
    expect(c.rows("SELECT * FROM proposals")).toHaveLength(2);
  });

  it("is one card listing both Scouts when two of them find it", async () => {
    const c = await opened(serving("revised"), {
      "a.yaml": scoutYaml({ name: "A" }),
      "b.yaml": scoutYaml({ name: "B" }),
    });
    await c.run("a");
    await c.run("b");

    const cards = await c.cards();

    expect(cards).toHaveLength(1);
    expect(cards[0]!.scouts.map((s) => s.name)).toEqual(["A", "B"]);
    expect(c.rows("SELECT * FROM appearances")).toHaveLength(2);
  });
});

describe("accept", () => {
  /** The stub the first paper of the normal feed becomes, as bytes. */
  const FIRST_STUB = [
    "---",
    "kind: source-stub",
    "citekey: muller2026",
    'title: "Probing the Overnight Benefit: Consolidation or Encoding?"',
    "authors:",
    "  - Anna Müller",
    "  - Jan Born",
    "year: 2026",
    "venue: Journal of Sleep Research 12 (2026) 1-9",
    "doi: 10.1000/xyz123",
    "url: http://arxiv.org/abs/2609.01234v1",
    "origin_scout: sleep",
    "origin_question:",
    '  - "[[Is the overnight benefit consolidation or encoding (RQ)]]"',
    "appearances:",
    "  - http://arxiv.org/abs/2609.01234v1",
    "---",
    "> We ask whether the overnight benefit is attributable to",
    "> consolidation & not to encoding strength. Tagged \\#sleep and \\[[linked\\]] here;",
    "> see also !\\[[embedded\\]] and a #2 that is no tag.",
    "",
  ].join("\n");

  it("writes the stub as the bytes § Scouts specifies", async () => {
    const c = await opened(serving("normal"));
    await c.run();
    const [, first] = await c.cards();

    const accepted = await c.accept(first!.id);

    expect(accepted).toEqual({ path: "sources/muller2026.md", held: false });
    expect(await c.read("sources/muller2026.md")).toBe(FIRST_STUB);
    expect(
      c.rows("SELECT state, stub_path FROM proposals WHERE id = " + first!.id)
    ).toEqual([{ state: "accepted", stub_path: "sources/muller2026.md" }]);
    expect(c.rows("SELECT action FROM triage")).toEqual([{ action: "accept" }]);
    expect((await c.cards()).map((card) => card.id)).not.toContain(first!.id);
  });

  it("leaves out venue, doi and the abstract's tail when arXiv gave none, and marks a Retroactive stub", async () => {
    const c = await opened(serving("normal"), {
      "sleep.yaml": scoutYaml({ search_back_to: "2026-07-01" }),
    });
    await c.run();
    const [second] = await c.cards();

    await c.accept(second!.id);

    const text = await c.read("sources/meer2026.md");
    expect(text).not.toMatch(/^venue:|^doi:/m);
    expect(text).toContain("origin_retroactive: true\n");
    expect(text.endsWith("---\n> A short abstract.\n")).toBe(true);
  });

  it("shows the vault index no tag and no link from the abstract", async () => {
    const c = await opened(serving("normal"));
    await c.run();
    const [, first] = await c.cards();
    await c.accept(first!.id);
    await c.c.indexed();

    const read = await c.c.query<{
      readable: boolean;
      outline: { tags: unknown[]; links: Array<{ target: string }> };
    }>("vault.outline", { path: "sources/muller2026.md" });
    const outline = { result: { data: read.result!.data.outline } };

    expect(read.result!.data.readable).toBe(true);
    expect(outline.result.data.tags).toEqual([]);
    // The Question link in the frontmatter is not a body link, so any link
    // here would have come from the abstract.
    expect(outline.result.data.links).toEqual([]);
  });

  it("escapes only what would begin a tag or a link, and nothing else", () => {
    expect(escapeThirdParty("plain text, a.b, a#b, 2#3")).toBe(
      "plain text, a.b, a#b, 2#3"
    );
    expect(escapeThirdParty("#tag")).toBe("\\#tag");
    expect(escapeThirdParty("see (#ml/probing) now")).toBe(
      "see (\\#ml/probing) now"
    );
    expect(escapeThirdParty("# 1 and #123")).toBe("# 1 and #123");
    expect(escapeThirdParty("[[a]] ![[b]] [single]")).toBe(
      "\\[[a\\]] !\\[[b\\]] [single]"
    );
  });

  it("writes nothing to any Question", async () => {
    const c = await opened(serving("normal"));
    const before = await c.read(QUESTION_PAGE);
    await c.run();
    for (const card of await c.cards()) await c.accept(card.id);

    expect(await c.read(QUESTION_PAGE)).toBe(before);
  });

  it("names every Assigned Question, and keeps an id that resolves to nothing", async () => {
    const c = await opened(serving("normal"), {
      "sleep.yaml": scoutYaml() + "  - gone-question\n",
    });
    await c.run();
    const [, first] = await c.cards();
    await c.accept(first!.id);

    const text = await c.read("sources/muller2026.md");
    expect(text).toContain(
      'origin_question:\n  - "[[Is the overnight benefit consolidation or encoding (RQ)]]"\n  - gone-question\n'
    );
  });

  it("takes the next citekey rather than overwriting one that is taken", async () => {
    const c = await opened(serving("normal"));
    await c.run();
    const cards = await c.cards();
    // `born2010.md` is in the fixture vault; this paper's citekey is muller2026,
    // taken by writing it first by hand.
    await writeFile(
      join(c.vault, "sources/muller2026.md"),
      "---\nkind: source\n---\nmine\n"
    );

    const [, first] = cards;
    const accepted = await c.accept(first!.id);

    expect(accepted.path).toBe("sources/muller2026a.md");
    expect(await c.read("sources/muller2026.md")).toBe(
      "---\nkind: source\n---\nmine\n"
    );
  });

  it("accepting twice is accepting once", async () => {
    const c = await opened(serving("normal"));
    await c.run();
    const [, first] = await c.cards();

    const [one, two] = await Promise.all([
      c.accept(first!.id),
      c.accept(first!.id),
    ]);

    expect(one).toEqual(two);
    expect(c.rows("SELECT * FROM triage")).toHaveLength(1);
  });
});

describe("held: work the vault already holds", () => {
  it("is held on arrival when a stub of its arXiv URL is already there, and is never a card", async () => {
    const c = await opened(serving("normal"));
    await writeFile(
      join(c.vault, "sources/mine.md"),
      "---\nkind: source-stub\ncitekey: mine\ntitle: Mine\nurl: https://arxiv.org/pdf/2609.01234v3.pdf\n---\n"
    );
    await settled(c.c);

    const run = await c.run();

    expect(run).toMatchObject({ fetched: 2, new: 1, held: 1 });
    expect((await c.cards()).map((card) => card.title)).toEqual([
      "Slow Oscillations Reconsidered",
    ]);
    expect(
      c.rows(
        "SELECT state, stub_path FROM proposals WHERE source_key = 'arxiv:2609.01234'"
      )
    ).toEqual([{ state: "held", stub_path: "sources/mine.md" }]);
    expect(c.rows("SELECT * FROM triage")).toEqual([]);
  });

  it("is held on arrival by a DOI, however the DOI is written", async () => {
    const c = await opened(serving("normal"));
    await writeFile(
      join(c.vault, "sources/mine.md"),
      "---\nkind: source\ncitekey: mine\ntitle: Mine\ndoi: https://doi.org/10.1000/XYZ123\n---\n"
    );
    await settled(c.c);

    expect(await c.run()).toMatchObject({ new: 1, held: 1 });
  });

  it("does not hold on a similar title", async () => {
    const c = await opened(serving("normal"));
    await writeFile(
      join(c.vault, "sources/mine.md"),
      "---\nkind: source\ncitekey: mine\ntitle: Slow Oscillations Reconsidered\n---\n"
    );
    await settled(c.c);

    expect(await c.run()).toMatchObject({ new: 2, held: 0 });
  });

  it("is checked again inside accept: a stub made by hand after arrival holds the card back and writes nothing", async () => {
    const c = await opened(serving("normal"));
    await c.run();
    const [second] = await c.cards();
    await writeFile(
      join(c.vault, "sources/mine.md"),
      "---\nkind: source-stub\ncitekey: mine\ntitle: Mine\nurl: http://arxiv.org/abs/2609.05678\n---\n"
    );
    await settled(c.c);

    const accepted = await c.accept(second!.id);

    expect(accepted).toEqual({ path: "sources/mine.md", held: true });
    expect(
      c.rows("SELECT state FROM proposals WHERE id = " + second!.id)
    ).toEqual([{ state: "held" }]);
    expect(c.rows("SELECT * FROM triage")).toEqual([]);
    expect(await c.read("sources/mine.md")).toContain("title: Mine");
    await expect(c.read("sources/meer2026.md")).rejects.toThrow();
  });

  it("adopts a stub orphaned by a crash between the write and the row, with no second file", async () => {
    const c = await opened(serving("normal"));
    await c.run();
    const [second] = await c.cards();
    // What an accept wrote before the core died: the file, and no row.
    await writeFile(
      join(c.vault, "sources/meer2026.md"),
      "---\nkind: source-stub\ncitekey: meer2026\ntitle: Slow Oscillations Reconsidered\nurl: http://arxiv.org/abs/2609.05678v1\n---\n> A short abstract.\n"
    );
    await settled(c.c);

    const accepted = await c.accept(second!.id);

    expect(accepted).toEqual({ path: "sources/meer2026.md", held: true });
    expect(
      c.rows("SELECT stub_path FROM proposals WHERE id = " + second!.id)
    ).toEqual([{ stub_path: "sources/meer2026.md" }]);
    await expect(c.read("sources/meer2026a.md")).rejects.toThrow();
  });
});

/** Have the index see what the test wrote beside the app, as the watcher would once settled. */
const settled = (c: Awaited<ReturnType<typeof core>>) =>
  c.mutate("vault.checkAgain");

describe("triage in Review", () => {
  const log = (c: Awaited<ReturnType<typeof opened>>) =>
    c.rows<{ proposal_id: number; action: string; batch: number | null }>(
      "SELECT proposal_id, action, batch FROM triage ORDER BY rowid"
    );

  it("reject writes a row and the paper is never proposed again, even revised", async () => {
    let feed = "normal";
    const c = await opened(async () => reply(await atom(feed)));
    await c.run();
    const [, first] = await c.cards();

    expect(await c.act("reject", { proposalId: first!.id })).toBeUndefined();
    feed = "revised";
    await c.run();

    expect(log(c)).toEqual([
      { proposal_id: first!.id, action: "reject", batch: null },
    ]);
    expect((await c.cards()).map((card) => card.id)).not.toContain(first!.id);
    // The revised version is an Appearance on the rejected row, not a card.
    expect(
      c.rows("SELECT * FROM appearances WHERE proposal_id = " + first!.id)
    ).toHaveLength(2);
    expect(c.rows("SELECT * FROM proposals")).toHaveLength(2);
  });

  it("defer writes a row and the paper returns at its place when that Scout's next run is clean", async () => {
    let status = 200;
    const c = await opened(async () => reply(await atom("normal"), status));
    await c.run();
    const before = (await c.cards()).map((card) => card.id);
    await c.act("defer", { proposalId: before[0]! });
    expect((await c.cards()).map((card) => card.id)).toEqual([before[1]]);

    // A failed run is not the next finished run.
    status = 503;
    await c.run();
    expect((await c.cards()).map((card) => card.id)).toEqual([before[1]]);
    status = 200;
    await c.run();

    expect((await c.cards()).map((card) => card.id)).toEqual(before);
    expect(log(c)).toEqual([
      { proposal_id: before[0], action: "defer", batch: null },
    ]);
  });

  it("a deferral ends with the run of the Scout that placed the paper, not of another that also found it", async () => {
    const c = await opened(serving("normal"), {
      "a.yaml": scoutYaml({ name: "A" }),
      "b.yaml": scoutYaml({ name: "B" }),
    });
    await c.run("a");
    await c.run("b");
    const [first] = await c.cards();
    await c.act("defer", { proposalId: first!.id });

    await c.run("b");
    expect((await c.cards()).map((card) => card.id)).not.toContain(first!.id);
    await c.run("a");

    expect((await c.cards()).map((card) => card.id)).toContain(first!.id);
  });

  it("undo of a reject or a defer appends an undo row and puts the card back", async () => {
    const c = await opened(serving("normal"));
    await c.run();
    const before = (await c.cards()).map((card) => card.id);
    await c.act("reject", { proposalId: before[0]! });
    await c.act("defer", { proposalId: before[1]! });

    expect(await c.act("undo", { proposalId: before[0]! })).toBeUndefined();
    expect(await c.act("undo", { proposalId: before[1]! })).toBeUndefined();

    expect((await c.cards()).map((card) => card.id)).toEqual(before);
    expect(log(c).map((row) => row.action)).toEqual([
      "reject",
      "defer",
      "undo",
      "undo",
    ]);
  });

  it("has no undo for accept, and none for a decision already taken back", async () => {
    const c = await opened(serving("normal"));
    await c.run();
    const [first, second] = await c.cards();
    await c.accept(first!.id);
    await c.act("reject", { proposalId: second!.id });
    await c.act("undo", { proposalId: second!.id });

    expect(await c.act("undo", { proposalId: first!.id })).toBe(
      "There is nothing to undo for that card."
    );
    expect(await c.act("undo", { proposalId: second!.id })).toBe(
      "There is nothing to undo for that card."
    );
    expect(log(c).map((row) => row.action)).toEqual([
      "accept",
      "reject",
      "undo",
    ]);
  });

  it("refuses to decide a card that is not in the stack", async () => {
    const c = await opened(serving("normal"));
    await c.run();
    const [first] = await c.cards();
    await c.accept(first!.id);

    expect(await c.act("reject", { proposalId: first!.id })).toBe(
      "That card is not in the stack."
    );
    expect(await c.act("defer", { proposalId: first!.id })).toBe(
      "That card is not in the stack."
    );
    expect(log(c).map((row) => row.action)).toEqual(["accept"]);
  });

  it("reject this run writes one reject row per pending Proposal, each carrying the run id", async () => {
    let feed = "normal";
    const c = await opened(async () => reply(await atom(feed)));
    const first = await c.run();
    feed = "revised";
    const second = await c.run();
    const [kept] = await c.cards();
    await c.act("defer", { proposalId: kept!.id });

    // The second run's only paper was found again: it is the run's, and it
    // is deferred, so only pending ones are the run's to reject.
    expect(await c.act("rejectRun", { runId: first.runId })).toBeUndefined();

    const rows = log(c);
    expect(rows.filter((row) => row.action === "reject")).toHaveLength(1);
    expect(rows.find((row) => row.action === "reject")?.batch).toBe(
      first.runId
    );
    expect(second.runId).not.toBe(first.runId);
    expect(await c.cards()).toEqual([]);
  });

  it("names, per Scout, its newest clean run, how much of it is pending, and the papers the vault already held", async () => {
    const c = await opened(serving("normal"));
    expect(await c.groups()).toEqual([
      { id: "sleep", runId: null, runPending: 0, held: [] },
    ]);
    await writeFile(
      join(c.vault, "sources/mine.md"),
      "---\nkind: source-stub\ncitekey: mine\ntitle: Mine\nurl: https://arxiv.org/pdf/2609.01234v3.pdf\n---\n"
    );
    await settled(c.c);
    const summary = await c.run();

    expect(await c.groups()).toEqual([
      {
        id: "sleep",
        runId: summary.runId,
        runPending: 1,
        held: [
          {
            title: "Probing the Overnight Benefit: Consolidation or Encoding?",
            path: "sources/mine.md",
          },
        ],
      },
    ]);
  });
});
