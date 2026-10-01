import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Card } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.location.hash = "#/scouts";
});

// The Scout Queue's tracer (#448): the Scouts that are files, *Run now*, one
// card in hand, and `A`. What the card says is only what is true: where it
// came from, what was assigned, and what the source did not supply.

const card = (rest: Partial<Card> = {}): Card => ({
  id: 7,
  title: "Slow Oscillations Reconsidered",
  authors: ["Ana van der Meer"],
  published: "2026-09-29T10:00:00Z",
  venue: null,
  abstract: "A short abstract.",
  url: "http://arxiv.org/abs/2609.05678v1",
  doi: null,
  lane: "review",
  scouts: [
    {
      id: "sleep",
      name: "Sleep and memory",
      assigned: [{ id: "rq1", name: "Is it consolidation?" }],
    },
  ],
  retroactive: false,
  ...rest,
});

const scouts = {
  scouts: [{ id: "sleep", name: "Sleep and memory" }],
  unreadable: [],
};

const answers = (queue: Card[], more: Record<string, unknown> = {}) => ({
  "vault.current": vault,
  "scouts.list": scouts,
  "scouts.queue": queue,
  "scouts.groups": [
    { id: "sleep", runId: 3, runPending: queue.length, held: [] },
  ],
  ...more,
});

describe("the Scout Queue", () => {
  it("draws the card in hand with why it is here, and says what is missing", async () => {
    renderApp(answers([card(), card({ id: 8, title: "Another" })]));

    const article = await screen.findByRole("article", {
      name: "Slow Oscillations Reconsidered",
    });

    expect(screen.getByText("card 1 of 2")).toBeDefined();
    expect(article.textContent).toContain("Sleep and memory");
    // *assigned to*, never *matches*: nothing has scored a match.
    expect(article.textContent).toContain("assigned to Is it consolidation?");
    expect(article.textContent).not.toMatch(/matches/i);
    const fields = Object.fromEntries(
      [...article.querySelectorAll("dt")].map((dt) => [
        dt.textContent,
        dt.nextElementSibling?.textContent,
      ])
    );
    expect(fields).toMatchObject({
      authors: "Ana van der Meer",
      published: "2026-09-29",
      venue: "missing",
      doi: "missing",
    });
    // arXiv never supplies keywords: the row is not drawn, not shown missing.
    expect(fields).not.toHaveProperty("keywords");
  });

  it("accepts the card with A and reads the Queue again", async () => {
    const accept = vi.fn(() => ({
      path: "sources/meer2026.md",
      held: false,
    }));
    renderApp(answers([card()], { "scouts.accept": accept }));
    const article = await screen.findByRole("article", {
      name: "Slow Oscillations Reconsidered",
    });

    fireEvent.keyDown(article, { key: "a" });

    expect(
      await screen.findByText("Accepted into sources/meer2026.md")
    ).toBeDefined();
    expect(accept).toHaveBeenCalledWith({ proposalId: 7 });
  });

  it("says when the vault already held the work", async () => {
    renderApp(
      answers([card()], {
        "scouts.accept": { path: "sources/mine.md", held: true },
      })
    );
    const article = await screen.findByRole("article", {
      name: "Slow Oscillations Reconsidered",
    });

    fireEvent.keyDown(article, { key: "A" });

    expect(
      await screen.findByText("Already in your vault: sources/mine.md")
    ).toBeDefined();
  });

  it("runs a Scout from its row and says what the run found", async () => {
    const runNow = vi.fn(() => ({
      runId: 1,
      outcome: "ok",
      errorKind: null,
      fetched: 5,
      new: 3,
      held: 1,
      truncated: 230,
    }));
    renderApp(answers([], { "scouts.runNow": runNow }));
    const list = await screen.findByRole("list", { name: "Scouts" });

    fireEvent.click(
      await within(list).findByRole("button", { name: "Run now" })
    );

    expect(
      await screen.findByText(
        "3 new · 1 already in your vault · stopped at 500 — 230 more matched"
      )
    ).toBeDefined();
    expect(runNow).toHaveBeenCalledWith({ scoutId: "sleep" });
  });

  it("states a failed run as failed, never as nothing found", async () => {
    renderApp(
      answers([], {
        "scouts.runNow": {
          runId: 1,
          outcome: "failed",
          errorKind: "http",
          fetched: 0,
          new: 0,
          held: 0,
          truncated: 0,
        },
      })
    );
    const list = await screen.findByRole("list", { name: "Scouts" });

    fireEvent.click(
      await within(list).findByRole("button", { name: "Run now" })
    );

    expect(await screen.findByText("This run failed: http.")).toBeDefined();
  });

  it("names a Scout file that does not parse", async () => {
    renderApp({
      ...answers([]),
      "scouts.list": {
        scouts: [],
        unreadable: [
          {
            file: "broken.yaml",
            sentence: "This file could not be read: line 2 is not valid YAML.",
          },
        ],
      },
    });

    expect(await screen.findByText("broken.yaml")).toBeDefined();
    expect(
      screen.getByText("This file could not be read: line 2 is not valid YAML.")
    ).toBeDefined();
  });

  describe("Review, worked from the keyboard", () => {
    const two = () => [card(), card({ id: 8, title: "Another" })];
    const hand = () => screen.findByRole("article");

    it("lists the rest of the stack under the card in hand, and the rail counts per Scout", async () => {
      renderApp(
        answers([
          card(),
          card({ id: 8, title: "Another" }),
          card({
            id: 9,
            title: "Elsewhere",
            scouts: [{ id: "other", name: "Other watch", assigned: [] }],
          }),
        ])
      );

      await hand();

      const rest = screen.getByRole("list", { name: "Next in the stack" });
      expect(
        within(rest)
          .getAllByRole("listitem")
          .map((li) => li.textContent)
      ).toEqual(["Another", "Elsewhere"]);
      const rail = screen.getByRole("list", { name: "Scouts" });
      expect(
        within(rail).getByRole("button", { name: /Sleep and memory/ })
          .textContent
      ).toBe("Sleep and memory2");
      expect(
        within(rail).getByRole("button", { name: /All Scouts/ }).textContent
      ).toBe("All Scouts3");
    });

    it("groups the stack by the Scout chosen on the rail", async () => {
      renderApp(
        answers(
          [
            card(),
            card({
              id: 9,
              title: "Elsewhere",
              scouts: [{ id: "other", name: "Other watch", assigned: [] }],
            }),
          ],
          {
            "scouts.list": {
              scouts: [
                { id: "sleep", name: "Sleep and memory" },
                { id: "other", name: "Other watch" },
              ],
              unreadable: [],
            },
          }
        )
      );
      await hand();

      fireEvent.click(screen.getByRole("button", { name: /Other watch/ }));

      expect(
        (await screen.findByRole("article")).getAttribute("aria-label")
      ).toBe("Elsewhere");
    });

    it("O opens the paper's page through the link rule and records nothing", async () => {
      const open = vi.spyOn(window, "open").mockImplementation(() => null);
      const writes = vi.fn();
      renderApp(
        answers([card({ url: "https://arxiv.org/abs/2609.05678" })], {
          "scouts.accept": writes,
          "scouts.reject": writes,
          "scouts.defer": writes,
        })
      );

      fireEvent.keyDown(await hand(), { key: "o" });

      expect(open).toHaveBeenCalledWith(
        "https://arxiv.org/abs/2609.05678",
        "_blank",
        "noopener,noreferrer"
      );
      expect(writes).not.toHaveBeenCalled();
      open.mockRestore();
    });

    it("O on a file: URL opens nothing and says which scheme it had", async () => {
      const open = vi.spyOn(window, "open").mockImplementation(() => null);
      renderApp(answers([card({ url: "file:///etc/passwd" })]));

      fireEvent.keyDown(await hand(), { key: "o" });

      expect(open).not.toHaveBeenCalled();
      expect(
        await screen.findByText("Vitrine will not follow file: links.")
      ).toBeDefined();
      open.mockRestore();
    });

    it("P moves the card to the bottom and records nothing, and wraps on the last", async () => {
      const writes = vi.fn();
      renderApp(
        answers(two(), {
          "scouts.accept": writes,
          "scouts.reject": writes,
          "scouts.defer": writes,
        })
      );
      let article = await hand();

      fireEvent.keyDown(article, { key: "p" });
      article = await screen.findByRole("article", { name: "Another" });
      expect(screen.getByText("card 1 of 2")).toBeDefined();
      fireEvent.keyDown(article, { key: "p" });

      // Both have been passed; the first comes round again.
      expect(
        await screen.findByRole("article", {
          name: "Slow Oscillations Reconsidered",
        })
      ).toBeDefined();
      expect(screen.getByText(/passed through every card/)).toBeDefined();
      expect(writes).not.toHaveBeenCalled();
    });

    it("R and D each ask the core for that one act", async () => {
      let cards = two();
      const gone = (input: unknown) => {
        const { proposalId } = input as { proposalId: number };
        cards = cards.filter((c) => c.id !== proposalId);
        return null;
      };
      const reject = vi.fn(gone);
      const defer = vi.fn(gone);
      renderApp(
        answers([], {
          "scouts.queue": () => cards,
          "scouts.reject": reject,
          "scouts.defer": defer,
        })
      );
      const article = await hand();

      fireEvent.keyDown(article, { key: "r" });
      await screen.findByText("Rejected “Slow Oscillations Reconsidered”.");
      const next = await screen.findByRole("article", { name: "Another" });
      fireEvent.keyDown(next, { key: "d" });

      expect(
        await screen.findByText("Deferred “Another” until the next run.")
      ).toBeDefined();
      expect(reject).toHaveBeenCalledWith({ proposalId: 7 });
      expect(defer).toHaveBeenCalledWith({ proposalId: 8 });
    });

    it("offers undo for a reject, and none after an accept", async () => {
      const undo = vi.fn(() => null);
      renderApp(
        answers(two(), {
          "scouts.reject": null,
          "scouts.accept": { path: "sources/x.md", held: false },
          "scouts.undo": undo,
        })
      );
      const article = await hand();
      expect(screen.queryByRole("button", { name: /^Undo/ })).toBeNull();

      fireEvent.keyDown(article, { key: "r" });
      fireEvent.click(
        await screen.findByRole("button", { name: "Undo reject" })
      );

      expect(
        await screen.findByText("Put “Slow Oscillations Reconsidered” back.")
      ).toBeDefined();
      expect(undo).toHaveBeenCalledWith({ proposalId: 7 });
      expect(screen.queryByRole("button", { name: /^Undo/ })).toBeNull();

      fireEvent.keyDown(await hand(), { key: "a" });
      await screen.findByText("Accepted into sources/x.md");
      expect(screen.queryByRole("button", { name: /^Undo/ })).toBeNull();
    });

    it("Reject this run clears the Scout's run in one act", async () => {
      const rejectRun = vi.fn(() => ({ rejected: 2 }));
      renderApp(answers(two(), { "scouts.rejectRun": rejectRun }));
      await hand();

      fireEvent.click(screen.getByRole("button", { name: /Sleep and memory/ }));
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Reject this run of Sleep and memory (2)",
        })
      );

      expect(
        await screen.findByText("Rejected 2 from this run.")
      ).toBeDefined();
      expect(rejectRun).toHaveBeenCalledWith({ runId: 3 });
    });

    it("counts what the vault already held across every Scout under All Scouts", async () => {
      renderApp(
        answers(two(), {
          "scouts.groups": [
            {
              id: "sleep",
              runId: 3,
              runPending: 2,
              held: [{ title: "Mine already", path: "sources/mine.md" }],
            },
          ],
        })
      );
      await hand();

      expect(await screen.findByText("1 already in your vault")).toBeDefined();
    });

    it("counts what the vault already held, each linking to its file", async () => {
      renderApp(
        answers(two(), {
          "scouts.groups": [
            {
              id: "sleep",
              runId: 3,
              runPending: 2,
              held: [{ title: "Mine already", path: "sources/mine.md" }],
            },
          ],
        })
      );
      await hand();

      fireEvent.click(screen.getByRole("button", { name: /Sleep and memory/ }));

      expect(await screen.findByText("1 already in your vault")).toBeDefined();
      expect(
        screen.getByRole("link", { name: "Mine already" }).getAttribute("href")
      ).toBe("#/source/sources/mine.md");
    });

    it("keeps its keys after focus moves to the rail", async () => {
      const reject = vi.fn(() => null);
      renderApp(answers(two(), { "scouts.reject": reject }));
      await hand();

      const row = screen.getByRole("button", { name: /Sleep and memory/ });
      row.focus();
      fireEvent.keyDown(row, { key: "r" });

      await screen.findByText("Rejected “Slow Oscillations Reconsidered”.");
      expect(reject).toHaveBeenCalledWith({ proposalId: 7 });
    });

    it("undoes with ⌘Z even when no card is left in hand", async () => {
      const undo = vi.fn(() => null);
      let cards = [card()];
      renderApp(
        answers([], {
          "scouts.queue": () => cards,
          "scouts.reject": () => {
            cards = [];
            return null;
          },
          "scouts.undo": undo,
        })
      );
      fireEvent.keyDown(await hand(), { key: "r" });
      await screen.findByText("Rejected “Slow Oscillations Reconsidered”.");
      await waitFor(() => expect(screen.queryByRole("article")).toBeNull());

      fireEvent.keyDown(document.body, { key: "z", metaKey: true });

      await waitFor(() => expect(undo).toHaveBeenCalledWith({ proposalId: 7 }));
    });

    it("forgets what was passed when another group is chosen", async () => {
      renderApp(
        answers([card()], {
          "scouts.list": {
            scouts: [
              { id: "sleep", name: "Sleep and memory" },
              { id: "other", name: "Other watch" },
            ],
            unreadable: [],
          },
        })
      );
      fireEvent.keyDown(await hand(), { key: "p" });
      expect(
        await screen.findByText(/passed through every card/)
      ).toBeDefined();

      fireEvent.click(screen.getByRole("button", { name: /Other watch/ }));

      expect(screen.queryByText(/passed through every card/)).toBeNull();
    });

    it("keeps the card in hand on screen as the keyboard moves the stack", async () => {
      const scroll = vi.fn();
      window.HTMLElement.prototype.scrollIntoView = scroll;
      renderApp(answers(two()));

      await hand();

      expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    });
  });

  describe("a link from third-party text goes through the one link rule", () => {
    it("lets an https link go out", async () => {
      renderApp(answers([card({ url: "https://arxiv.org/abs/2609.05678" })]));
      const article = await screen.findByRole("article");

      expect(
        within(article)
          .getByRole("link", { name: "https://arxiv.org/abs/2609.05678" })
          .getAttribute("href")
      ).toBe("https://arxiv.org/abs/2609.05678");
    });

    it("draws a file: link as plainly not a link, and says so when asked", async () => {
      renderApp(answers([card({ url: "file:///etc/passwd" })]));
      const article = await screen.findByRole("article");

      expect(within(article).queryByRole("link")).toBeNull();
      fireEvent.click(
        within(article).getByRole("button", {
          name: "not a link: file:///etc/passwd",
        })
      );
      expect(
        await within(article).findByText("Vitrine will not follow file: links.")
      ).toBeDefined();
    });
  });
});
