import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { empty, question, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// The foot of Home and the page's absences (spec #728, ticket #735): three
// links to the dashboards with nothing summarised, and the things Home must
// never have — a badge, a total, a count of what is not being looked at, an
// alert for a state, *nothing is broken*. Through App with the core faked.

const watched = {
  indexing: null,
  watching: { ok: true },
  current: { ok: true },
};
const NO_REVIEW = {
  pending: 0,
  pastWindow: 0,
  deferred: 0,
  median: null,
  oldest: null,
};
const SINCE = "2026-09-14T12:00:00.000Z";

const looking = {
  id: "density-watch",
  health: { voice: "claim", warrant: null },
  lastCostUsd: null,
};

const answers: Record<string, unknown> = {
  "vault.current": vault,
  "questions.list": empty,
  "vault.status": watched,
  "vault.kinds": ["question"],
  "vault.tree": [{ path: "questions/a.md", kind: "question" }],
  "looseEnds.rows": { groups: [], problems: [] },
  "home.away": { since: null },
  "vault.pdfFault": null,
  "home.changed": { since: SINCE, groups: [] },
  "home.resurfaced": { questions: [] },
  "scouts.depth": NO_REVIEW,
  "scouts.activity": { rows: [] },
  "scouts.health": { scouts: [looking], unreadable: [] },
  "scouts.fleet": { claim: "1 scout watching", naming: [] },
};

const BROKEN_ROW = {
  kind: "scout",
  id: "density-watch",
  name: "density-watch",
  source: { kind: "arxiv", query: "all:density", tags: null },
  cadence: "weekly",
  dueUnder: [],
  assigned: [],
  lane: "review",
  paused: false,
  lastWindow: null,
  lastRun: { finished: "2026-09-30T10:00:00.000Z", ago: "3 d ago" },
  health: {
    voice: "wrong",
    kind: "network",
    sentence: "arXiv did not answer on the last check.",
  },
  acceptRate: { kind: "nothing triaged" },
  review: NO_REVIEW,
  volume: {
    proposals: 0,
    held: 0,
    alsoFoundElsewhere: 0,
    belowCap: 0,
    muted: 0,
  },
  cost: { kind: "no model call" },
};

const home = () => screen.findByRole("region", { name: "Home" });

describe("the dashboards foot", () => {
  it("is three links to the dashboards, in order, and nothing else", async () => {
    renderApp(answers);
    const foot = within(await home()).getByRole("navigation", {
      name: "Dashboards",
    });
    const links = within(foot).getAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["Loose Ends", "#/loose-ends"],
      ["Question Map", "#/question-map"],
      ["Scout Activity", "#/scout-activity"],
    ]);
    // Nothing summarised: the foot holds the three names and no digit.
    expect(foot.textContent).not.toMatch(/\d/);
  });

  it("is the last thing on the page, after every other section", async () => {
    renderApp({
      ...answers,
      "scouts.depth": { ...NO_REVIEW, pending: 3 },
      "home.changed": {
        since: SINCE,
        groups: [
          {
            topic: { kind: "untagged" },
            items: [
              {
                path: "n.md",
                kind: "note",
                sentence: "Note edited",
                title: "n",
                at: "2026-09-20T08:00:00.000Z",
              },
            ],
          },
        ],
      },
      "questions.list": {
        ...empty,
        questions: [question("Old one?", "2025-08-14T09:00:00+01:00", {})],
      },
      "home.resurfaced": {
        questions: [question("Old one?", "2025-08-14T09:00:00+01:00", {})],
      },
    });
    const page = await home();
    await within(page).findByRole("region", {
      name: "Changed while you were away",
    });
    await within(page).findByRole("region", { name: "From the notebook" });
    const order = [
      "Waiting",
      "Changed while you were away",
      "From the notebook",
      "Dashboards",
    ].map((name) => {
      const el =
        page.querySelector(`[aria-label="${name}"]`) ??
        within(page).getByRole("heading", { name }).closest("section")!;
      return el;
    });
    for (let i = 1; i < order.length; i++) {
      expect(
        order[i - 1]!.compareDocumentPosition(order[i]!) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
    // Keyboard tab order is document order here: no tabindex reorders it.
    expect(
      page.querySelectorAll("[tabindex]:not([tabindex='-1'])")
    ).toHaveLength(0);
    const focusable = [...page.querySelectorAll("a[href], button")];
    const last = focusable.slice(-3).map((e) => e.textContent);
    expect(last).toEqual(["Loose Ends", "Question Map", "Scout Activity"]);
  });
});

describe("what Home must never have", () => {
  const problems = Array.from({ length: 6 }, (_, i) => ({
    path: `n${i}.md`,
  }));

  it("puts no number beside Loose Ends, however much is loose", async () => {
    renderApp({
      ...answers,
      "looseEnds.rows": {
        groups: [{ name: "Loose", rows: problems }],
        problems,
      },
    });
    const page = await home();
    const link = within(page).getByRole("link", { name: "Loose Ends" });
    expect(link.textContent).toBe("Loose Ends");
    expect(page.textContent).not.toMatch(/Loose Ends\W*\d|\d+\W*loose/i);
  });

  it("puts no badge, number or dot on the Sidebar's Home entry", async () => {
    renderApp({
      ...answers,
      "scouts.depth": { ...NO_REVIEW, pending: 9 },
    });
    await home();
    const nav = screen.getByRole("navigation", { name: "Surfaces" });
    const link = within(nav).getByRole("link", { name: "Home" });
    expect(link.textContent).toBe("Home");
    // The one child is the entry's own marker, textless: it is on every row.
    for (const child of link.children) expect(child.textContent).toBe("");
    expect(link.getAttribute("aria-label")).toBeNull();
    // The Sidebar's other entries are as bare: nothing waiting is a debt.
    for (const a of within(nav).getAllByRole("link"))
      expect(a.textContent).not.toMatch(/\d/);
  });

  it("counts neither Questions, changes nor Scouts not looking", async () => {
    renderApp({
      ...answers,
      "scouts.health": {
        scouts: [
          looking,
          { ...looking, id: "a", health: { voice: "not yet", sentence: "p" } },
          { ...looking, id: "b", health: { voice: "not yet", sentence: "p" } },
        ],
        unreadable: [],
      },
      "scouts.fleet": { claim: "1 scout watching", naming: ["a", "b"] },
    });
    const page = await home();
    await within(page).findByText(/These are not: a, b\./);
    expect(page.textContent).not.toMatch(
      /\b(\d+|two|three) (scouts? (are )?not|questions?|changes?|unwatched)/i
    );
    expect(page.textContent).not.toMatch(/\b\d+ (of|out of) \d+/);
  });

  it("raises no alert for a state: a broken Scout, a failed read, an empty field", async () => {
    const broken = {
      id: "density-watch",
      health: {
        voice: "wrong",
        kind: "network",
        sentence: "arXiv did not answer.",
      },
      lastCostUsd: null,
    };
    renderApp({
      ...answers,
      "scouts.health": { scouts: [broken], unreadable: [] },
      "scouts.fleet": { claim: null, naming: ["density-watch"] },
      "scouts.activity": { rows: [BROKEN_ROW] },
      "home.changed": () => {
        throw new Error("the index cannot be read");
      },
      "scouts.depth": () => {
        throw new Error("the queue cannot be read");
      },
    });
    const page = await home();
    await within(page).findByText(/arXiv did not answer on the last check/);
    await within(page).findByText(/could not tell what changed/);
    await within(page).findByText(/could not tell what waits in Review/);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(
      page.querySelectorAll("[role='alert'], [aria-live='assertive']")
    ).toHaveLength(0);
  });

  it("never says nothing is broken, in any state it can be in", async () => {
    for (const fleet of [
      { claim: "1 scout watching", naming: [] },
      { claim: null, naming: [] },
      { claim: null, naming: ["density-watch"] },
    ]) {
      cleanup();
      renderApp({
        ...answers,
        "scouts.fleet": fleet,
        ...(fleet.claim === null && fleet.naming.length > 0
          ? {
              "scouts.health": {
                scouts: [
                  { ...looking, health: { voice: "wrong", sentence: "x" } },
                ],
                unreadable: [],
              },
            }
          : {}),
      });
      const page = await home();
      // The first sentence has landed, so the negative below is not vacuous.
      await within(page).findAllByText(/watching|not looking yet|not working/);
      expect(page.textContent).not.toMatch(
        /nothing is (broken|wrong)|all (is )?well|everything is fine/i
      );
    }
  });

  it("styles with tokens and gutters: no border, rule or colour literal", () => {
    const css = readFileSync(`${__dirname}/Home.module.css`, "utf8");
    // The only border is `border: none` on a control (ADR 0023: gutters).
    for (const m of css.matchAll(/border(?!-radius)[\w-]*\s*:\s*([^;]+);/g))
      expect(m[1]!.trim()).toBe("none");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    expect(css).not.toMatch(/outline\s*:\s*\d|box-shadow\s*:\s*[^v]*\d+px/);
    const tsx = ["Home", "HomeChanged", "HomeInterrupt", "Resurfaced"]
      .map((f) => readFileSync(`${__dirname}/${f}.tsx`, "utf8"))
      .join("\n");
    expect(tsx).not.toMatch(/<hr\b|<table\b/);
  });
});

describe("opening Home writes nothing", () => {
  const READS = new Set(Object.keys(answers));

  it("calls only reads: no mutation reaches the core", async () => {
    const called: string[] = [];
    const spy = new Proxy(answers, {
      get(target, key) {
        if (typeof key === "string") called.push(key);
        return Reflect.get(target, key) as unknown;
      },
    });
    renderApp(spy);
    await home();
    await waitFor(() => expect(called.length).toBeGreaterThan(5));
    const unknown = called.filter((p) => !READS.has(p));
    // Anything beyond the reads the fixture answers would be a write or a
    // read this test has not been told about; both want a look.
    expect(unknown).toEqual([]);
  });
});

describe("currency: a vaultChanged updates the section it concerns", () => {
  const change = {
    type: "vaultChanged" as const,
    changed: ["questions/a.md"],
    removed: [],
    renamed: [],
  };

  it("brings a finished Scout run into the first sentence", async () => {
    let fleet = { claim: "1 scout watching", naming: [] as string[] };
    const { stream } = renderApp({ ...answers, "scouts.fleet": () => fleet });
    const page = await home();
    await within(page).findByText("1 scout watching.");
    fleet = { claim: "2 scouts watching", naming: [] };
    stream.push(change);
    await within(page).findByText("2 scouts watching.");
  });

  it("brings a newly broken Scout into the interrupt", async () => {
    let rows: unknown[] = [];
    const { stream } = renderApp({
      ...answers,
      "scouts.activity": () => ({ rows }),
    });
    const page = await home();
    expect(within(page).queryByText(/arXiv did not answer/)).toBeNull();
    rows = [BROKEN_ROW];
    stream.push(change);
    await within(page).findByText(/arXiv did not answer on the last check/);
  });

  it("brings a new proposal into Waiting", async () => {
    let depth = { ...NO_REVIEW, pending: 2 };
    const { stream } = renderApp({ ...answers, "scouts.depth": () => depth });
    const page = await home();
    await within(page).findByText("2 in Review");
    depth = { ...NO_REVIEW, pending: 3 };
    stream.push(change);
    await within(page).findByText("3 in Review");
  });

  it("brings a captured Question into what changed", async () => {
    let groups: unknown[] = [];
    const { stream } = renderApp({
      ...answers,
      "home.changed": () => ({ since: SINCE, groups }),
    });
    const page = await home();
    await within(page).findByText(/Nothing has changed/);
    groups = [
      {
        topic: { kind: "untagged" },
        items: [
          {
            path: "questions/new.md",
            kind: "question",
            sentence: "Question captured",
            title: "Why now?",
            at: "2026-09-20T08:00:00.000Z",
          },
        ],
      },
    ];
    stream.push(change);
    await within(page).findByRole("link", { name: /Why now\?/ });
  });

  it("brings a file edited on disk into the notebook", async () => {
    let shown = [question("Before edit?", "2025-08-14T09:00:00+01:00", {})];
    const { stream } = renderApp({
      ...answers,
      "home.resurfaced": () => ({ questions: shown }),
    });
    const page = await home();
    await within(page).findByText("Before edit?");
    shown = [question("After edit?", "2025-08-14T09:00:00+01:00", {})];
    stream.push(change);
    await within(page).findByText("After edit?");
  });
});
