import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// Home's *changed while you were away* (spec #728, RES-4): items grouped under
// the Tag each is about, each leading to its own Address, with no figure that
// counts them. Through App with the core faked.

const watched = {
  indexing: null,
  watching: { ok: true },
  current: { ok: true },
};

const SINCE = "2026-09-14T12:00:00.000Z";

const answers = {
  "vault.current": vault,
  "questions.list": empty,
  "vault.status": watched,
  "vault.kinds": ["question"],
  "vault.tree": [{ path: "questions/a.md", kind: "question" }],
  "looseEnds.rows": { groups: [], problems: [] },
  "home.away": { since: null },
  "home.changed": { since: SINCE, groups: [] },
  "scouts.health": {
    scouts: [
      {
        id: "a",
        health: { voice: "claim", sentence: "a", warrant: null },
        lastCostUsd: null,
      },
    ],
    unreadable: [],
  },
  "scouts.fleet": {
    claim: "1 scout watching · all parsed cleanly",
    naming: [],
  },
};

const item = (path: string, kind: "question" | "note", title: string) => ({
  path,
  kind,
  sentence: kind === "question" ? "Question captured" : "Note edited",
  title,
  at: "2026-09-20T08:00:00.000Z",
});

const page = () => screen.findByRole("region", { name: "Home" });

describe("changed while you were away", () => {
  it("groups items under their Tag and links each to its own Address", async () => {
    renderApp({
      ...answers,
      "home.changed": {
        since: SINCE,
        groups: [
          {
            topic: { kind: "tag", tag: "ml/probing" },
            items: [
              item("questions/why.md", "question", "Why does it probe?"),
              item("notes/probe notes.md", "note", "probe notes"),
            ],
          },
          { topic: { kind: "untagged" }, items: [item("n.md", "note", "n")] },
        ],
      },
    });
    const section = await within(await page()).findByRole("region", {
      name: "Changed while you were away",
    });
    const headings = within(section).getAllByRole("heading", { level: 3 });
    expect(headings.map((h) => h.textContent)).toEqual([
      "ml/probing",
      "untagged",
    ]);
    expect(
      within(section)
        .getByRole("link", { name: /Why does it probe\?/ })
        .getAttribute("href")
    ).toBe("#/question/questions/why.md");
    // A Note opens in the Vault, not on a surface of its own.
    expect(
      within(section)
        .getByRole("link", { name: /probe notes/ })
        .getAttribute("href")
    ).toBe("#/vault/notes/probe%20notes.md");
    expect(section.textContent).toContain("Question captured");
    expect(section.textContent).toContain("Note edited");
  });

  it("counts nothing: no figure appears in the section", async () => {
    renderApp({
      ...answers,
      "home.changed": {
        since: SINCE,
        groups: [
          {
            topic: { kind: "tag", tag: "ml" },
            items: [item("questions/a.md", "question", "Why?")],
          },
        ],
      },
    });
    const section = await within(await page()).findByRole("region", {
      name: "Changed while you were away",
    });
    expect(section.textContent).not.toMatch(/\d+ (changes|items|topics)/);
    expect(section.textContent).not.toMatch(/\d+ (more|others)/);
  });

  it("names an invalid Tag by its reason", async () => {
    renderApp({
      ...answers,
      "home.changed": {
        since: SINCE,
        groups: [
          {
            topic: { kind: "invalid", reason: "contains whitespace" },
            items: [item("questions/a.md", "question", "Why?")],
          },
        ],
      },
    });
    const section = await within(await page()).findByRole("region", {
      name: "Changed while you were away",
    });
    expect(section.textContent).toContain("contains whitespace");
  });

  it("says nothing changed as a claim with its Warrant, not an empty heading", async () => {
    renderApp(answers);
    const section = await within(await page()).findByRole("region", {
      name: "Changed while you were away",
    });
    expect(section.textContent).toContain("Nothing has changed.");
    expect(section.textContent).toContain(
      "questions, notes, revisions, accepted stubs and runs since 14 Sep"
    );
    expect(within(section).queryAllByRole("heading", { level: 3 })).toEqual([]);
  });

  it("is a wrong voice with a reason when the read fails, never an empty section", async () => {
    renderApp({
      ...answers,
      "home.changed": () => {
        throw new Error("index is unreadable");
      },
    });
    const section = await within(await page()).findByRole("region", {
      name: "Changed while you were away",
    });
    expect(section.textContent).toContain("could not tell what changed");
    expect(section.textContent).toContain("index is unreadable");
    expect(section.textContent).not.toContain("Nothing has changed");
    expect(within(section).queryByRole("alert")).toBeNull();
  });

  it("makes no claim of nothing while the vault is still being read", async () => {
    renderApp({
      ...answers,
      "vault.status": { ...watched, indexing: { done: 3, total: 90 } },
    });
    await within(await page()).findByText("reading");
    // A macrotask, so the section's own query has answered before the absence is asserted.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText("Nothing has changed.")).toBeNull();
  });

  it("opens each Revision, run and accepted stub at its own Kind's Address", async () => {
    const at = "2026-09-20T08:00:00.000Z";
    renderApp({
      ...answers,
      "home.changed": {
        since: SINCE,
        groups: [
          {
            topic: { kind: "untagged" },
            items: [
              {
                path: "h/a.md",
                kind: "hypothesis",
                sentence: "Claim revised",
                title: "a",
                at,
              },
              {
                path: "r/b.md",
                kind: "research-question",
                sentence: "Working answer revised",
                title: "b",
                at,
              },
              {
                path: "e/c.md",
                kind: "experiment",
                sentence: "Experiment run recorded",
                title: "c",
                at,
              },
              {
                path: "s/d.md",
                kind: "source",
                sentence: "Source stub accepted",
                title: "d",
                at,
              },
            ],
          },
        ],
      },
    });
    const section = await within(await page()).findByRole("region", {
      name: "Changed while you were away",
    });
    const href = (name: string) =>
      within(section).getByRole("link", { name }).getAttribute("href");
    expect(href("a")).toBe("#/hypothesis/h/a.md");
    expect(href("b")).toBe("#/research-question/r/b.md");
    expect(href("c")).toBe("#/experiment/e/c.md");
    expect(href("d")).toBe("#/source/s/d.md");
  });
});
