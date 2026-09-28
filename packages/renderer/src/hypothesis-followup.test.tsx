import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { HypothesisPage, Loop, Related } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, pressCaptureChord, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// The follow-up question and the related rail (#339; spec #327 stories 18,
// 71–74; ADR 0031 decision 11). Whenever the result is closable the page
// offers the follow-up, captured through the one capture path as
// `resolving`; any other capture made with the page on screen is
// `pursuing`. The rail is the object promoted from and every Question whose
// `from:` names the page — the core's query, drawn.

const PATH = "hypotheses/The pooled effect is mostly small-study bias.md";
const HASH =
  "#/hypothesis/hypotheses/The%20pooled%20effect%20is%20mostly%20small-study%20bias.md";
const QUESTION = "questions/Does the reanalysis shrink the pooled effect.md";

type Readable = Extract<HypothesisPage, { readable: true }>;

const closable: Loop = {
  status: "open",
  parent: { path: QUESTION, kind: "question" },
  refusal: null,
  result: "falsified",
};

const noRelated: Related = { promotedFrom: null, questions: [] };

const page = (loop: Loop, related: Related = noRelated): Readable => ({
  readable: true,
  path: PATH,
  hash: "abc",
  frontmatter: { context: "other", tags: [] },
  sections: {
    claim: {
      present: true,
      text: "The pooled effect is mostly small-study bias.",
    },
    criteria: { present: true, criteria: [] },
    designNotes: { present: true, text: "" },
    positionHistory: { present: true, text: "", entries: [] },
  },
  derivation: {
    state: "falsified",
    effective: "falsified",
    override: null,
    clause: "falsifyingMet",
    named: ["F1"],
    unlanded: ["F1"],
    census: { met: 1, notMet: 0, inconclusive: 0, awaiting: 0 },
  },
  overridable: false,
  loop,
  related,
  problems: [],
});

const open = (
  current: () => HypothesisPage,
  more: Record<string, unknown> = {}
) => {
  window.location.hash = HASH;
  return renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": {
      indexing: null,
      watching: { ok: true },
      current: { ok: true },
    },
    "hypotheses.page": current,
    "picker.candidates": { rows: [], total: 0 },
    ...more,
  });
};

const followUp = () => screen.findByRole("region", { name: "The follow-up" });
const rail = () => screen.findByRole("complementary", { name: "Related" });

const captured = (text: string, context: string) => ({
  id: "k7m2p9q4wx",
  path: `${vault.path}/questions/${text}.md`,
  question: text,
  status: "open",
  captured: "2026-09-30T10:00:00+05:30",
  from: "[[The pooled effect is mostly small-study bias]]",
  context,
});

describe("the follow-up question", () => {
  it("is offered when the result is closable, and captures as `resolving` with the page as its `from:`", async () => {
    let current = page(closable);
    const capture = vi.fn(({ text }: { text: string }) => {
      current = page(closable, {
        promotedFrom: null,
        questions: [
          {
            path: `questions/${text}.md`,
            question: text,
            status: "open",
            context: "resolving",
            captured: "2026-09-30T10:00:00+05:30",
          },
        ],
      });
      return captured(text, "resolving");
    });
    open(() => current, { "questions.capture": capture });

    const box = within(await followUp()).getByRole("textbox", {
      name: "Follow-up question",
    });
    fireEvent.change(box, {
      target: { value: "What produces the dispersion, then?" },
    });
    fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() =>
      expect(capture).toHaveBeenCalledWith({
        text: "What produces the dispersion, then?",
        provenance: { context: "resolving", hypothesis: PATH },
      })
    );
    await waitFor(() => expect((box as HTMLInputElement).value).toBe(""));
    const neighbours = await rail();
    expect(
      await within(neighbours).findByText("What produces the dispersion, then?")
    ).toBeTruthy();
    expect(neighbours.textContent).toContain(
      "question · the follow-up to this result"
    );
  });

  it("is not offered while the result is not closable", async () => {
    open(() =>
      page({
        ...closable,
        refusal: "A criterion still awaits evidence.",
        result: "inconclusive",
      })
    );
    await screen.findByRole("region", { name: "The loop" });
    expect(screen.queryByRole("region", { name: "The follow-up" })).toBeNull();
  });

  it("is still offered on a Hypothesis promoted from nothing", async () => {
    open(() => page({ status: "none", refusal: null, result: "falsified" }));
    expect(
      within(await followUp()).getByRole("textbox", {
        name: "Follow-up question",
      })
    ).toBeTruthy();
  });

  it("keeps the text and says why when the capture is refused", async () => {
    open(() => page(closable), {
      "questions.capture": () => {
        throw new Error("Couldn't write the Question into questions/: EACCES");
      },
    });
    const region = await followUp();
    const box = within(region).getByRole("textbox", {
      name: "Follow-up question",
    });
    fireEvent.change(box, { target: { value: "What next?" } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(await within(region).findByRole("alert")).toBeTruthy();
    expect((box as HTMLInputElement).value).toBe("What next?");
  });
});

describe("any other capture on the page", () => {
  it("is `pursuing`, with the page as its `from:`", async () => {
    const capture = vi.fn(({ text }: { text: string }) =>
      captured(text, "pursuing")
    );
    open(() => page(closable), { "questions.capture": capture });
    await screen.findByRole("region", { name: "Hypothesis view" });

    pressCaptureChord();
    expect(screen.getByRole("form", { name: "Capture" }).textContent).toContain(
      "Pursuing · The pooled effect is mostly small-study bias"
    );
    const input = screen.getByRole("textbox", { name: "Question" });
    fireEvent.change(input, {
      target: { value: "Is the stratum boundary arbitrary?" },
    });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(capture).toHaveBeenCalledWith({
        text: "Is the stratum boundary arbitrary?",
        provenance: { context: "pursuing", page: PATH },
      })
    );
  });
});

describe("the related rail", () => {
  it("names the object promoted from, and every Question naming the page, each linked to where it opens", async () => {
    open(() =>
      page(closable, {
        promotedFrom: {
          link: "[[Does the reanalysis shrink the pooled effect]]",
          path: QUESTION,
          kind: "question",
          display: "Does the reanalysis shrink the pooled effect?",
          reason: null,
        },
        questions: [
          {
            path: "questions/The follow-up.md",
            question: "The follow-up?",
            status: "open",
            context: "resolving",
            captured: "2026-09-23T09:00:00+05:30",
          },
          {
            path: "questions/Raised while designing.md",
            question: "Raised while designing?",
            status: "answered",
            context: "pursuing",
            captured: "2026-09-22T09:00:00+05:30",
          },
        ],
      })
    );
    const neighbours = await rail();
    const items = within(neighbours).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Does the reanalysis shrink the pooled effect?question · the parent",
      "The follow-up?question · the follow-up to this result",
      "Raised while designing?question · raised on this page · answered",
    ]);
    expect(
      within(neighbours)
        .getByRole("link", {
          name: "Does the reanalysis shrink the pooled effect?",
        })
        .getAttribute("href")
    ).toBe(
      "#/question/questions/Does%20the%20reanalysis%20shrink%20the%20pooled%20effect.md"
    );
    expect(
      within(neighbours)
        .getByRole("link", { name: "The follow-up?" })
        .getAttribute("href")
    ).toBe("#/question/questions/The%20follow-up.md");
  });

  it("names a parent that does not resolve, unlinked, rather than dropping it", async () => {
    open(() =>
      page(closable, {
        promotedFrom: {
          link: "[[Nowhere]]",
          path: null,
          kind: null,
          display: null,
          reason: "[[Nowhere]] matches no file in the vault",
        },
        questions: [],
      })
    );
    const neighbours = await rail();
    expect(within(neighbours).queryByRole("link")).toBeNull();
    expect(neighbours.textContent).toContain("Nowhere");
    expect(neighbours.textContent).toContain("matches no file in the vault");
  });

  it("says quietly what belongs there when there is nothing yet", async () => {
    open(() => page(closable));
    const neighbours = await rail();
    expect(within(neighbours).queryByRole("listitem")).toBeNull();
    expect(neighbours.textContent).toContain(
      "Questions captured on this page land here."
    );
  });
});
