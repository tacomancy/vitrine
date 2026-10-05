import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import type { CandidateQuestion, Coverage } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// The inferred-link review on the Question Map (#487; ADR 0041 decisions
// 9–10): the Scout Queue's grammar over (Question, paper) pairs.

const READ = { indexing: null, watching: { ok: true }, current: { ok: true } };
const COVERAGE: Coverage = { depth: 1, deepest: 1, rows: [], tags: [] };

const paper = (name: string, shared = ["sleep"]) => ({
  path: `s/${name}.md`,
  kind: "source" as const,
  display: name,
  shared,
});
const QUESTIONS: CandidateQuestion[] = [
  {
    path: "q/Many.md",
    id: "q-many",
    question: "Why many?",
    captured: "2026-09-01T10:00:00Z",
    candidates: [paper("one"), paper("two"), paper("three")],
  },
  {
    path: "q/Few.md",
    id: "q-few",
    question: "Why few?",
    captured: "2026-09-02T10:00:00Z",
    candidates: [paper("four")],
  },
];

const open = (candidates: unknown = QUESTIONS, link: unknown = vi.fn()) => {
  window.location.hash = "#/question-map";
  renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": READ,
    "questionMap.coverage": COVERAGE,
    "questionMap.candidates": candidates,
    "questions.link": link,
  });
  return link as ReturnType<typeof vi.fn>;
};

const panel = () => screen.findByRole("region", { name: "Candidate links" });
const listbox = async () => within(await panel()).findByRole("listbox");
const key = (k: string) =>
  act(() => void fireEvent.keyDown(document, { key: k }));
const chosen = async () => {
  const list = await listbox();
  return document.getElementById(list.getAttribute("aria-activedescendant")!)!
    .textContent;
};

describe("the candidate review", () => {
  it("opens on the Question with the most candidates, with no count and no backlog note", async () => {
    open();
    const view = await panel();
    expect(view.textContent).toContain("Why many?");
    expect(view.textContent).not.toMatch(/\d+ of \d+|backlog|total/i);
    expect(within(await listbox()).getAllByRole("option")).toHaveLength(3);
    expect(await chosen()).toContain("one");
  });

  it("moves focus with j and k, following the published id", async () => {
    open();
    await listbox();
    key("j");
    expect(await chosen()).toContain("two");
    key("j");
    key("j");
    expect(await chosen()).toContain("three");
    key("k");
    expect(await chosen()).toContain("two");
  });

  it("accepts the focused candidate through questions.link and then decides it", async () => {
    const link = open();
    await listbox();
    key("j");
    key("A");
    await vi.waitFor(() =>
      expect(link).toHaveBeenCalledWith({
        path: "q/Many.md",
        target: "s/two.md",
      })
    );
    await vi.waitFor(async () =>
      expect(
        within(await listbox())
          .getAllByRole("option")
          .map((o) => o.textContent)
          .join()
      ).not.toContain("two")
    );
  });

  it("passes without writing, returning the candidate to the bottom of the stack", async () => {
    const link = open();
    await listbox();
    key("P");
    const list = await listbox();
    const names = within(list)
      .getAllByRole("option")
      .map((o) => /one|two|three/.exec(o.textContent)![0]);
    expect(names).toEqual(["two", "three", "one"]);
    expect(await chosen()).toContain("two");
    expect(link).not.toHaveBeenCalled();
  });

  it("opens the paper on O and decides nothing", async () => {
    const link = open();
    await listbox();
    key("O");
    await vi.waitFor(() =>
      expect(window.location.hash).toBe("#/source/s/one.md")
    );
    expect(link).not.toHaveBeenCalled();
  });

  it("offers next question — and nothing more — once every candidate is decided or passed", async () => {
    open();
    await listbox();
    expect(screen.queryByRole("button", { name: "next question" })).toBeNull();
    key("A");
    await vi.waitFor(async () =>
      expect(within(await listbox()).getAllByRole("option")).toHaveLength(2)
    );
    key("P");
    key("P");
    const next = await screen.findByRole("button", { name: "next question" });
    fireEvent.click(next);
    expect((await panel()).textContent).toContain("Why few?");
    expect(screen.queryByRole("button", { name: "next question" })).toBeNull();
  });

  it("says a refusal on the candidate and keeps it", async () => {
    open(
      QUESTIONS,
      vi.fn(() => {
        throw new Error("q/Many.md is not readable.");
      })
    );
    await listbox();
    key("A");
    expect((await panel()).textContent).toContain("q/Many.md is not readable.");
    expect(within(await listbox()).getAllByRole("option")).toHaveLength(3);
  });

  it("says so as a Claim when no Question has a candidate", async () => {
    open([]);
    const view = await panel();
    expect(view.textContent).toMatch(/No candidate links/);
    expect(view.textContent).toContain("read in full · watching");
  });
});
