import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { VaultStatus } from "core";
import { empty, renderApp, vault } from "./fake-core";

afterEach(cleanup);

// The Inbox's first slot in the three Voices (ADR 0032; prototype 12's
// contrast set, 5). Prototype 12 says the three differ in four places; the
// first three are here — the slot's face, the Warrant, the footer — and the
// rail's hollow entries are at the foot of this file (#347).

const well: VaultStatus = {
  indexing: null,
  watching: { ok: true },
  current: { ok: true },
};

const CLAIM = "No questions have been captured in this vault.";
const WARRANT = "read in full · watching";

async function inbox() {
  return screen.findByRole("region", { name: "Question Inbox" });
}

describe("an empty Inbox, read in full and watched", () => {
  it("claims nothing has been captured, with its Warrant beside it", async () => {
    renderApp({
      "vault.current": vault,
      "questions.list": empty,
      "vault.status": well,
    });
    const region = await inbox();
    expect(await within(region).findByText(CLAIM)).toBeDefined();
    expect(within(region).getByText(WARRANT)).toBeDefined();
    // The paragraph on how questions arrive, once, below the claim.
    expect(region.textContent).toContain(
      "A question lands here when you capture one"
    );
    // The claim is the only word on how many: no count, and nothing that
    // reads as *all clear* (prototype 12, panel 2).
    expect(region.textContent).not.toMatch(/\d+ questions?/);
    // The footer holds the key legend and nothing the vault has to say.
    expect(within(region).getByRole("contentinfo").textContent).toBe(
      "j/k movep promotel linka answerd dropr reopen"
    );
  });
});

describe("an empty Inbox while the vault is still being read", () => {
  it("says not read yet, a fragment with no Warrant, and the footer shows the read's progress", async () => {
    renderApp({
      "vault.current": vault,
      "questions.list": empty,
      "vault.status": {
        ...well,
        indexing: { done: 1250, total: 8400 },
        current: { ok: false, reason: "a sweep has not completed" },
      },
    });
    const region = await inbox();
    expect(await within(region).findByText("not read yet")).toBeDefined();
    expect(region.textContent).not.toContain(CLAIM);
    expect(region.textContent).not.toContain(WARRANT);
    const footer = within(region).getByRole("contentinfo");
    expect(footer.textContent).toContain(
      "◐ reading the vault · 1,250 of 8,400 files"
    );
  });
});

describe("an empty Inbox the app cannot vouch for", () => {
  it("says not known while the vault is not watched, and the reason and retry are the footer's", async () => {
    renderApp({
      "vault.current": vault,
      "questions.list": empty,
      "vault.status": {
        ...well,
        watching: {
          ok: false,
          reason: "the app lost permission to read the vault folder",
        },
        current: { ok: false, reason: "not watching" },
      },
    });
    const region = await inbox();
    expect(await within(region).findByText("not known")).toBeDefined();
    expect(region.textContent).not.toContain(CLAIM);
    expect(region.textContent).not.toContain(WARRANT);
    // A state the app is in, stated quietly: polite, never an alert.
    const line = within(region).getByRole("status");
    expect(line.textContent).toBe(
      "‖ not watching — the app lost permission to read the vault folder · retry"
    );
    expect(within(line).getByRole("button", { name: "retry" })).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says not known when the listing failed, with the reason in the footer on a polite line", async () => {
    renderApp({
      "vault.current": vault,
      "questions.list": () => {
        throw new Error("No vault is open.");
      },
      "vault.status": well,
    });
    const region = await inbox();
    expect(await within(region).findByText("not known")).toBeDefined();
    expect(region.textContent).not.toContain(CLAIM);
    expect(region.textContent).not.toContain(WARRANT);
    const footer = within(region).getByRole("contentinfo");
    expect(within(footer).getByRole("status").textContent).toBe(
      "‖ not read — No vault is open."
    );
    expect(screen.queryByRole("alert")).toBeNull();
    // A failed read must never read as an empty vault.
    expect(region.textContent).not.toMatch(/\d+ questions?/);
  });

  it("says not known when files could not be read, since the vault was not read in full", async () => {
    renderApp({
      "vault.current": vault,
      "questions.list": {
        ...empty,
        unreadable: [
          { path: "/v/consolidation-vault/Garbled.md", reason: "bad" },
        ],
      },
      "vault.status": well,
    });
    const region = await inbox();
    expect(await within(region).findByText("not known")).toBeDefined();
    expect(region.textContent).not.toContain(CLAIM);
    expect(region.textContent).not.toContain(WARRANT);
    // The reason is the footer's, as the unreadable count already says it.
    expect(region.textContent).toContain("1 file could not be read");
  });

  it("says not known when vault.status itself failed, and the footer says why", async () => {
    renderApp({
      "vault.current": vault,
      "questions.list": empty,
      "vault.status": () => {
        throw new Error("the core did not answer");
      },
    });
    const region = await inbox();
    expect(await within(region).findByText("not known")).toBeDefined();
    expect(region.textContent).not.toContain(CLAIM);
    const footer = within(region).getByRole("contentinfo");
    expect(within(footer).getByRole("status").textContent).toBe(
      "‖ vault state not known — the core did not answer"
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

// Loose Ends in the same three Voices (#346; prototype 12, panel 3). *yet*
// is gone from the claim — it sounded like a promise — and the honest-empty
// weight is the Warrant's.

const NOTHING_LOOSE = "Nothing is loose that the app can see.";
const SCOPE = "This page gathers what has come apart or gone quiet";

function looseEnds(more: Record<string, unknown>) {
  window.location.hash = "#/loose-ends";
  renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": well,
    "looseEnds.rows": { groups: [], problems: [] },
    ...more,
  });
  return screen.findByRole("region", { name: "Loose Ends" });
}

describe("Loose Ends with nothing loose, read in full and watched", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("claims nothing is loose, with its Warrant and the page's scope, and no footer", async () => {
    const region = await looseEnds({});
    expect(await within(region).findByText(NOTHING_LOOSE)).toBeDefined();
    expect(within(region).getByText(WARRANT)).toBeDefined();
    expect(region.textContent).toContain(SCOPE);
    expect(region.textContent).not.toContain("Nothing to tidy");
    expect(region.textContent).not.toMatch(/\byet\b/);
    // Nothing for the vault to say, so no footer at all (prototype 12, 5a).
    expect(within(region).queryByRole("contentinfo")).toBeNull();
  });
});

describe("Loose Ends while the rows or the vault are still being read", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("says not read yet while the vault is being read, and the footer shows the read's progress", async () => {
    const region = await looseEnds({
      "vault.status": {
        ...well,
        indexing: { done: 1250, total: 8400 },
        current: { ok: false, reason: "a sweep has not completed" },
      },
    });
    expect(await within(region).findByText("not read yet")).toBeDefined();
    expect(region.textContent).not.toContain(NOTHING_LOOSE);
    expect(region.textContent).not.toContain(WARRANT);
    expect(region.textContent).not.toContain(SCOPE);
    expect(within(region).getByRole("contentinfo").textContent).toBe(
      "◐ reading the vault · 1,250 of 8,400 files"
    );
  });

  it("says not read yet while the rows have not arrived", async () => {
    const region = await looseEnds({
      "looseEnds.rows": () => new Promise(() => {}),
    });
    expect(await within(region).findByText("not read yet")).toBeDefined();
    expect(region.textContent).not.toContain(NOTHING_LOOSE);
    expect(region.textContent).not.toContain(WARRANT);
    expect(within(region).queryByRole("contentinfo")).toBeNull();
  });
});

describe("Loose Ends the app cannot vouch for", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("says not known when the read failed, with the reason in the footer on a polite line", async () => {
    const region = await looseEnds({
      "looseEnds.rows": () => {
        throw new Error("No vault is open.");
      },
    });
    expect(await within(region).findByText("not known")).toBeDefined();
    expect(region.textContent).not.toContain(NOTHING_LOOSE);
    expect(region.textContent).not.toContain(WARRANT);
    const footer = within(region).getByRole("contentinfo");
    expect(within(footer).getByRole("status").textContent).toBe(
      "‖ not read — No vault is open."
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says not known while the vault is not watched, and the reason and retry are the footer's", async () => {
    const region = await looseEnds({
      "vault.status": {
        ...well,
        watching: {
          ok: false,
          reason: "the app lost permission to read the vault folder",
        },
        current: { ok: false, reason: "not watching" },
      },
    });
    expect(await within(region).findByText("not known")).toBeDefined();
    expect(region.textContent).not.toContain(NOTHING_LOOSE);
    expect(region.textContent).not.toContain(WARRANT);
    const footer = within(region).getByRole("contentinfo");
    expect(within(footer).getByRole("status").textContent).toBe(
      "‖ not watching — the app lost permission to read the vault folder · retry"
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says not known when the dashboard could not judge everything, and says what in the footer", async () => {
    const region = await looseEnds({
      "looseEnds.rows": {
        groups: [],
        problems: [
          ".vitrine/dismissals.json could not be read, so nothing is silenced",
        ],
      },
    });
    expect(await within(region).findByText("not known")).toBeDefined();
    expect(region.textContent).not.toContain(NOTHING_LOOSE);
    expect(region.textContent).not.toContain(WARRANT);
    const footer = within(region).getByRole("contentinfo");
    expect(within(footer).getByRole("status").textContent).toBe(
      "‖ could not judge — .vitrine/dismissals.json could not be read, so nothing is silenced"
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says not known when vault.status itself failed, and the footer says why", async () => {
    const region = await looseEnds({
      "vault.status": () => {
        throw new Error("the core did not answer");
      },
    });
    expect(await within(region).findByText("not known")).toBeDefined();
    expect(region.textContent).not.toContain(NOTHING_LOOSE);
    expect(region.textContent).not.toContain(WARRANT);
    const footer = within(region).getByRole("contentinfo");
    expect(within(footer).getByRole("status").textContent).toBe(
      "‖ vault state not known — the core did not answer"
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

// The fourth difference: the rail on an empty vault (#347; prototype 12,
// panel 4). A built entry with nothing in it keeps its place and label,
// goes hollow, and says where its contents will come from — but saying an
// entry has nothing is a claim, so only the claim state may say it.

const RQ_HINT = "promoted from a question";
const HYP_HINT = "from a research question";

async function rail(answers: Record<string, unknown>) {
  renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": well,
    "vault.kinds": [],
    ...answers,
  });
  const nav = await screen.findByRole("navigation", { name: "Surfaces" });
  // Once the Inbox's slot speaks in any Voice the rail's reads, answered
  // on the same ticks, have landed too — so a missing hint is an answer.
  await within(await inbox()).findByText(
    (text) => text === CLAIM || text === "not read yet" || text === "not known"
  );
  return nav;
}

const entry = (nav: HTMLElement, name: string) =>
  within(nav)
    .getAllByRole("listitem")
    .find((li) => li.textContent?.startsWith(name)) as HTMLElement;

describe("the rail on an empty vault, read in full and watched", () => {
  it("draws a built entry with nothing in it hollow, with where its contents come from", async () => {
    const nav = await rail({});
    await within(nav).findByText(RQ_HINT);
    const rq = entry(nav, "Research Question view");
    expect(rq.textContent).toBe("Research Question view" + RQ_HINT);
    const hyp = entry(nav, "Hypothesis view");
    expect(hyp.textContent).toBe("Hypothesis view" + HYP_HINT);
    // Waiting, not broken: still a place on the map, and nothing to click.
    expect(within(rq).queryByRole("link")).toBeNull();
    // Only built entries say where their contents come from; an entry with
    // no surface yet makes no promise about one.
    expect(entry(nav, "Reader").textContent).toBe("Reader");
    expect(entry(nav, "Experiment view").textContent).toBe("Experiment view");
  });

  it("draws an entry with contents as it always was", async () => {
    const nav = await rail({ "vault.kinds": ["research-question"] });
    await within(nav).findByText(HYP_HINT);
    expect(entry(nav, "Research Question view").textContent).toBe(
      "Research Question view"
    );
    expect(entry(nav, "Hypothesis view").textContent).toBe(
      "Hypothesis view" + HYP_HINT
    );
  });
});

describe("the rail claims nothing while it cannot vouch for the vault", () => {
  const noHints = (nav: HTMLElement) => {
    expect(nav.textContent).not.toContain(RQ_HINT);
    expect(nav.textContent).not.toContain(HYP_HINT);
    expect(entry(nav, "Research Question view").textContent).toBe(
      "Research Question view"
    );
  };

  it("while the vault is being read", async () => {
    const nav = await rail({
      "vault.status": {
        ...well,
        indexing: { done: 1250, total: 8400 },
        current: { ok: false, reason: "a sweep has not completed" },
      },
    });
    noHints(nav);
  });

  it("while the vault is not watched", async () => {
    const nav = await rail({
      "vault.status": {
        ...well,
        watching: {
          ok: false,
          reason: "the app lost permission to read the vault folder",
        },
        current: { ok: false, reason: "not watching" },
      },
    });
    noHints(nav);
  });

  it("when a later read of what the vault holds fails, rather than keep the last answer", async () => {
    let reads = 0;
    const { stream } = renderApp({
      "vault.current": vault,
      "questions.list": empty,
      "vault.status": well,
      "vault.kinds": () => {
        if (reads++ === 0) return [];
        throw new Error("the core did not answer");
      },
    });
    const nav = await screen.findByRole("navigation", { name: "Surfaces" });
    await within(nav).findByText(RQ_HINT);
    stream.push({
      type: "vaultChanged",
      changed: ["notes/a.md"],
      removed: [],
      renamed: [],
    });
    await waitFor(() => expect(nav.textContent).not.toContain(RQ_HINT));
    noHints(nav);
  });

  it("when it could not learn what the vault holds", async () => {
    const nav = await rail({
      "vault.kinds": () => {
        throw new Error("the core did not answer");
      },
    });
    noHints(nav);
  });
});
