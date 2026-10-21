import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { empty, pressGlobalChord, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// Home (spec #728, ticket #729): the window's landing, and its first sentence
// in the Voice the fleet's liveness has earned. Every case goes through App
// with the core faked, because what is under test is what the researcher is
// told — and, for a broken Scout, that no claim is made at all.

const watched = {
  indexing: null,
  watching: { ok: true },
  current: { ok: true },
};

const SCOUT = (id: string, voice: "claim" | "wrong" | "not yet") => ({
  id,
  health: { voice, sentence: `${id} ${voice}`, warrant: null },
  lastCostUsd: null,
});

const answers = {
  "vault.current": vault,
  "questions.list": empty,
  "vault.status": watched,
  "vault.kinds": ["question"],
  "vault.tree": [{ path: "questions/a.md", kind: "question" }],
  "looseEnds.rows": { groups: [], problems: [] },
  "home.away": { since: null },
  "home.resurfaced": { questions: [] },
  "scouts.health": {
    scouts: [
      SCOUT("sleep-proceedings", "claim"),
      SCOUT("density-watch", "claim"),
    ],
    unreadable: [],
  },
  "scouts.fleet": {
    claim:
      "2 scouts watching · all parsed cleanly · newest run 3 h ago · last new proposal 14 Sep",
    naming: [],
  },
};

const home = () => screen.findByRole("region", { name: "Home" });

describe("Home is the landing", () => {
  it("lands on Home with no hash, and writes #/home", async () => {
    renderApp(answers);
    await home();
    expect(window.location.hash).toBe("#/home");
    expect(screen.queryByRole("region", { name: "Question Inbox" })).toBeNull();
  });

  it("still lands on the Inbox for a hash it does not know", async () => {
    window.location.hash = "#/nowhere";
    renderApp(answers);
    await screen.findByRole("region", { name: "Question Inbox" });
    expect(window.location.hash).toBe("#/inbox");
    expect(screen.queryByRole("region", { name: "Home" })).toBeNull();
  });

  it("still lands on the Inbox naming a retired Address", async () => {
    window.location.hash = "#/questions/old.md";
    renderApp(answers);
    const inbox = await screen.findByRole("region", { name: "Question Inbox" });
    expect(inbox.textContent).toContain("#/questions/old.md");
  });

  it("is an Address: Back returns to it", async () => {
    renderApp(answers);
    await home();
    fireEvent.click(screen.getByRole("link", { name: "Question Inbox" }));
    await screen.findByRole("region", { name: "Question Inbox" });
    window.history.back();
    await home();
    expect(window.location.hash).toBe("#/home");
  });

  it("opens from #/home", async () => {
    window.location.hash = "#/home";
    renderApp(answers);
    await home();
  });
});

describe("the Sidebar and ⌘K reach Home", () => {
  it("draws Home as a live link, lit while on it, with no number or badge", async () => {
    renderApp(answers);
    await home();
    const nav = screen.getByRole("navigation", { name: "Surfaces" });
    const link = within(nav).getByRole("link", { name: "Home" });
    expect(link.getAttribute("href")).toBe("#/home");
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(link.textContent).toBe("Home");
    expect(within(nav).getAllByRole("link", { current: "page" })).toHaveLength(
      1
    );
  });

  it("is lit nowhere else, and goes there from another surface", async () => {
    window.location.hash = "#/loose-ends";
    renderApp(answers);
    await screen.findByRole("region", { name: "Loose Ends" });
    const nav = screen.getByRole("navigation", { name: "Surfaces" });
    const link = within(nav).getByRole("link", { name: "Home" });
    expect(link.getAttribute("aria-current")).toBeNull();
    fireEvent.click(link);
    await home();
  });

  it("is offered by ⌘K, and goes there", async () => {
    window.location.hash = "#/loose-ends";
    renderApp({
      ...answers,
      "globalCommand.destinations": { rows: [], total: 0 },
    });
    await screen.findByRole("region", { name: "Loose Ends" });
    pressGlobalChord();
    const dialog = await screen.findByRole("dialog", {
      name: "Global command",
    });
    await within(dialog).findByRole("option", { name: /Home/ });
    const box = within(dialog).getByRole("combobox");
    fireEvent.change(box, { target: { value: "home" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await home();
  });
});

describe("the dateline", () => {
  it("names the day, the date and the time", async () => {
    renderApp(answers);
    const page = await home();
    expect(
      within(page).getByText(
        /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) \d{1,2} \w+ · \d{2}:\d{2}/
      )
    ).toBeDefined();
  });

  it("says nothing of an absence on an ordinary day", async () => {
    renderApp(answers);
    expect((await home()).textContent).not.toContain("away");
  });

  it("says away since the day, after a gap", async () => {
    renderApp({ ...answers, "home.away": { since: "2026-09-14" } });
    const page = await home();
    await within(page).findByText(/away since the 14th of September/);
  });
});

describe("the first sentence", () => {
  it("is the coverage-of-looking claim with its Warrant when Scouts exist and none is broken", async () => {
    renderApp(answers);
    const page = await home();
    await within(page).findByText("2 scouts watching.");
    expect(page.textContent).toContain(
      "all parsed cleanly · newest run 3 h ago · last new proposal 14 Sep"
    );
  });

  it("names the Scouts that are not looking, and never counts them", async () => {
    renderApp({
      ...answers,
      "scouts.health": {
        scouts: [
          SCOUT("a", "claim"),
          SCOUT("density-watch", "not yet"),
          SCOUT("sleep-proceedings", "not yet"),
        ],
        unreadable: [],
      },
      "scouts.fleet": {
        claim:
          "1 scout watching · all parsed cleanly · newest run 1 h ago · last new proposal 14 Sep · density-watch, sleep-proceedings not looking",
        naming: ["density-watch", "sleep-proceedings"],
      },
    });
    const page = await home();
    await within(page).findByText(/^1 scout watching\./);
    expect(page.textContent).toContain(
      "These are not: density-watch, sleep-proceedings."
    );
    // Named in the sentence, not repeated in the Warrant after it.
    expect(page.textContent).not.toContain("not looking");
    expect(page.textContent).not.toMatch(/\b(two|2) (are|scouts are) not/i);
  });

  it("makes no claim when any Scout is broken, and names it", async () => {
    renderApp({
      ...answers,
      "scouts.health": {
        scouts: [SCOUT("a", "claim"), SCOUT("density-watch", "wrong")],
        unreadable: [],
      },
      "scouts.fleet": { claim: null, naming: ["density-watch"] },
    });
    const page = await home();
    await within(page).findByText(/density-watch/);
    expect(page.textContent).not.toContain("watching");
    expect(page.textContent).not.toMatch(/nothing is broken/i);
    expect(within(page).getByText("‖")).toBeDefined();
  });

  it("names a Scout file that does not parse by its file name", async () => {
    renderApp({
      ...answers,
      "scouts.health": {
        scouts: [],
        unreadable: [
          {
            file: "mine.md",
            health: { voice: "wrong", sentence: "x", warrant: null },
          },
        ],
      },
      "scouts.fleet": { claim: null, naming: ["mine.md"] },
    });
    const page = await home();
    await within(page).findByText(/mine\.md/);
    expect(page.textContent).not.toContain("watching");
    expect(within(page).getByText("‖")).toBeDefined();
  });

  it("is not yet for a fleet that is all not looking: named, no claim", async () => {
    renderApp({
      ...answers,
      "scouts.health": {
        scouts: [SCOUT("density-watch", "not yet")],
        unreadable: [],
      },
      "scouts.fleet": { claim: null, naming: ["density-watch"] },
    });
    const page = await home();
    await within(page).findByText(/density-watch/);
    expect(page.textContent).not.toContain("watching");
    expect(within(page).queryByText("‖")).toBeNull();
  });

  it("is not yet, with no full stop, for no Scouts, and offers the way to brief one", async () => {
    renderApp({
      ...answers,
      "scouts.health": { scouts: [], unreadable: [] },
      "scouts.fleet": { claim: null, naming: [] },
    });
    const page = await home();
    const said = await within(page).findByText("no scouts yet");
    expect(said.textContent).not.toMatch(/\.$/);
    const way = within(page).getByRole("link", { name: "brief one" });
    expect(way.getAttribute("href")).toBe("#/scouts");
  });

  it("says it is reading while the vault is being read, and claims nothing", async () => {
    renderApp({
      ...answers,
      "vault.status": { ...watched, indexing: { done: 3, total: 90 } },
    });
    const page = await home();
    await within(page).findByText("reading");
    expect(page.textContent).not.toContain("watching");
    expect(page.textContent).not.toContain("nothing here");
  });

  it("claims, with its Warrant, that a vault read in full holds nothing, and offers the two ways in", async () => {
    renderApp({
      ...answers,
      "vault.tree": [],
      "vault.kinds": [],
      "scouts.health": { scouts: [], unreadable: [] },
      "scouts.fleet": { claim: null, naming: [] },
    });
    const page = await home();
    await within(page).findByText("Nothing here yet.");
    expect(page.textContent).toContain("read in full · watching");
    expect(page.textContent).toContain("capture a question");
    expect(page.textContent).toContain("PDF folder");
  });

  it("is wrong, with the reason, when the Scouts folder could not be read", async () => {
    renderApp({
      ...answers,
      "scouts.health": () => {
        throw new Error("the scouts folder cannot be read");
      },
      "scouts.fleet": () => {
        throw new Error("the scouts folder cannot be read");
      },
    });
    const page = await home();
    await within(page).findByText(/could not tell/);
    expect(page.textContent).toContain("the scouts folder cannot be read");
    expect(page.textContent).not.toContain("no scouts yet");
    expect(within(page).getByText("‖")).toBeDefined();
  });
});

describe("a failed read of the vault's files", () => {
  it("says it could not tell what the vault holds, not that the scouts failed", async () => {
    renderApp({
      ...answers,
      "vault.tree": () => {
        throw new Error("the index cannot be read");
      },
    });
    const page = await home();
    await within(page).findByText(/could not tell what the vault holds/);
    expect(page.textContent).toContain("the index cannot be read");
    expect(page.textContent).not.toContain("scouts are looking");
  });
});

describe("opening another vault", () => {
  it("lands on Home", async () => {
    window.location.hash = "#/loose-ends";
    const { stream } = renderApp(answers);
    await screen.findByRole("region", { name: "Loose Ends" });
    const other = { name: "other", path: "/v/other" };
    stream.push({ type: "vaultSwitched", vault: other });
    await home();
    expect(window.location.hash).toBe("#/home");
  });
});
