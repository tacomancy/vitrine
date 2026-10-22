import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Card } from "core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.location.hash = "#/scouts";
});

// #584 (ADR 0033 decisions 5–8, spec #581): the Queue's one line chooses its
// role per message. A refusal of the user's own act is an alert; what was done
// stays a status; the line holds the latest of either.

const card = (rest: Partial<Card> = {}): Card => ({
  id: 7,
  title: "Slow Oscillations Reconsidered",
  authors: ["Ana van der Meer"],
  published: "2026-09-29T10:00:00Z",
  venue: null,
  venueType: null,
  abstract: "A short abstract.",
  url: "http://arxiv.org/abs/2609.05678v1",
  doi: null,
  lane: "review",
  scouts: [
    { id: "sleep", name: "Sleep and memory", assigned: [], dropped: false },
  ],
  retroactive: false,
  signals: [],
  moved: null,
  pastWindow: false,
  counterweight: false,
  ...rest,
});

const answers = (queue: Card[], more: Record<string, unknown> = {}) => ({
  "vault.current": vault,
  "scouts.list": {
    scouts: [
      { id: "sleep", name: "Sleep and memory", assigned: [], paused: false },
    ],
    unreadable: [],
  },
  "scouts.queue": queue,
  "scouts.groups": [
    { id: "sleep", runId: 3, runPending: queue.length, held: [] },
  ],
  "scouts.health": { scouts: [] },
  "scouts.muted": { rules: [], problem: null, items: [] },
  "scouts.fleet": { claim: null, naming: [] },
  "scouts.skim": { recent: queue, older: [] },
  ...more,
});

const refused = "That could not be done: the vault is read-only.";
const refuse = () => {
  throw new Error(refused);
};

const cardInHand = () =>
  screen.findByRole("article", { name: "Slow Oscillations Reconsidered" });
const rail = () => screen.findByRole("list", { name: "Scouts" });
const chooseScout = async () =>
  fireEvent.click(
    await within(await rail()).findByRole("button", {
      name: /Sleep and memory/,
    })
  );
const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

/** An answer held until the test settles it: a macrotask is the only way the in-flight state is on screen. */
function held() {
  let settle: (outcome: { ok: unknown } | { error: Error }) => void = () => {};
  const promise = new Promise((resolve, reject) => {
    settle = (outcome) =>
      "ok" in outcome ? resolve(outcome.ok) : reject(outcome.error);
  });
  return { promise, settle };
}

describe("a refused act in the Scout Queue", () => {
  const acts: Array<{
    name: string;
    run: (more?: Record<string, unknown>) => Promise<void>;
  }> = [
    {
      name: "accept",
      run: async (more) => {
        renderApp(answers([card()], { "scouts.accept": refuse, ...more }));
        fireEvent.keyDown(await cardInHand(), { key: "a" });
      },
    },
    {
      name: "reject",
      run: async (more) => {
        renderApp(answers([card()], { "scouts.reject": refuse, ...more }));
        fireEvent.keyDown(await cardInHand(), { key: "r" });
      },
    },
    {
      name: "defer",
      run: async (more) => {
        renderApp(answers([card()], { "scouts.defer": refuse, ...more }));
        fireEvent.keyDown(await cardInHand(), { key: "d" });
      },
    },
    {
      name: "undo",
      run: async (more) => {
        renderApp(
          answers([card()], {
            "scouts.reject": {},
            "scouts.undo": refuse,
            ...more,
          })
        );
        fireEvent.keyDown(await cardInHand(), { key: "r" });
        fireEvent.click(await screen.findByRole("button", { name: /Undo/ }));
      },
    },
    {
      name: "promote to Review",
      run: async (more) => {
        renderApp(answers([card()], { "scouts.promote": refuse, ...more }));
        fireEvent.click(await screen.findByRole("radio", { name: "Skim" }));
        fireEvent.keyDown(await cardInHand(), { key: "t" });
      },
    },
    {
      name: "pause",
      run: async (more) => {
        renderApp(answers([], { "scouts.setPaused": refuse, ...more }));
        await chooseScout();
        fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
      },
    },
    {
      name: "run now",
      run: async (more) => {
        renderApp(answers([], { "scouts.runNow": refuse, ...more }));
        fireEvent.click(
          await within(await rail()).findByRole("button", { name: "Run now" })
        );
      },
    },
    {
      name: "reject this run",
      run: async (more) => {
        renderApp(answers([card()], { "scouts.rejectRun": refuse, ...more }));
        await chooseScout();
        fireEvent.click(
          await screen.findByRole("button", { name: /Reject this run/ })
        );
      },
    },
  ];

  it.each(acts)(
    "$name is an alert carrying the core's sentence, and no status stands in its place",
    async ({ run }) => {
      await run();

      expect((await screen.findByRole("alert")).textContent).toBe(refused);
      expect(screen.queryByRole("status")).toBeNull();
    }
  );

  it("is replaced by an acknowledgment, which is a status and not an alert", async () => {
    let attempts = 0;
    renderApp(
      answers([card(), card({ id: 8, title: "Another" })], {
        "scouts.accept": () => {
          if (attempts++ === 0) refuse();
          return { path: "sources/meer2026.md", held: false };
        },
      })
    );
    fireEvent.keyDown(await cardInHand(), { key: "a" });
    await screen.findByRole("alert");

    fireEvent.keyDown(await cardInHand(), { key: "a" });

    const line = await screen.findByRole("status");
    expect(line.textContent).toBe("Accepted into sources/meer2026.md");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("replaces an acknowledgment with a refusal in the one line", async () => {
    let attempts = 0;
    renderApp(
      answers([card(), card({ id: 8, title: "Another" })], {
        "scouts.accept": () => {
          if (attempts++ === 0) return { path: "sources/x.md", held: false };
          return refuse();
        },
      })
    );
    fireEvent.keyDown(await cardInHand(), { key: "a" });
    await screen.findByRole("status");

    fireEvent.keyDown(await cardInHand(), { key: "a" });

    expect((await screen.findByRole("alert")).textContent).toBe(refused);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("is replaced by the acknowledgment of an act that was still in flight when it was said", async () => {
    const accepting = held();
    renderApp(
      answers([card()], {
        "scouts.accept": () => accepting.promise,
        "scouts.setPaused": refuse,
      })
    );
    fireEvent.keyDown(await cardInHand(), { key: "a" });
    await chooseScout();
    fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
    await screen.findByRole("alert");

    accepting.settle({ ok: { path: "sources/x.md", held: false } });

    expect((await screen.findByRole("status")).textContent).toBe(
      "Accepted into sources/x.md"
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("is a status when the Run now ran and failed: the failure is the Scout's own voice", async () => {
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
    fireEvent.click(
      await within(await rail()).findByRole("button", { name: "Run now" })
    );

    expect((await screen.findByRole("status")).textContent).toBe(
      "This run failed: http."
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    ["accept", { key: "a" }, "accepted", "Accepted into sources/x.md"],
    [
      "reject",
      { key: "r" },
      "rejected",
      "Rejected “Slow Oscillations Reconsidered”.",
    ],
    [
      "defer",
      { key: "d" },
      "deferred",
      "Deferred “Slow Oscillations Reconsidered” until the next run.",
    ],
  ])(
    "leaves an acknowledgment of %s a status",
    async (_name, key, _kind, words) => {
      renderApp(
        answers([card()], {
          "scouts.accept": { path: "sources/x.md", held: false },
          "scouts.reject": {},
          "scouts.defer": {},
        })
      );
      fireEvent.keyDown(await cardInHand(), key);

      expect((await screen.findByRole("status")).textContent).toBe(words);
      expect(screen.queryByRole("alert")).toBeNull();
    }
  );

  it("is gone while the same act is in flight again, and refused again it is a new element", async () => {
    let attempts = 0;
    const second = held();
    renderApp(
      answers([card()], {
        "scouts.accept": () => {
          if (attempts++ === 0) refuse();
          return second.promise;
        },
      })
    );
    const article = await cardInHand();
    fireEvent.keyDown(article, { key: "a" });
    const first = await screen.findByRole("alert");

    fireEvent.keyDown(article, { key: "a" });

    await waitFor(() => expect(attempts).toBe(2));
    await flush();
    expect(screen.queryByRole("alert")).toBeNull();
    second.settle({ error: new Error(refused) });
    const again = await screen.findByRole("alert");
    expect(again.textContent).toBe(refused);
    expect(first.isConnected).toBe(false);
    expect(again).not.toBe(first);
  });

  it("is forgotten by a pause that succeeds and says nothing", async () => {
    let attempts = 0;
    renderApp(
      answers([], {
        "scouts.setPaused": () => {
          if (attempts++ === 0) refuse();
          return {};
        },
      })
    );
    await chooseScout();
    const pause = await screen.findByRole("button", { name: "Pause" });
    fireEvent.click(pause);
    await screen.findByRole("alert");

    fireEvent.click(pause);

    await waitFor(() => expect(attempts).toBe(2));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("a refused address on a Proposal card", () => {
  const sentence = "Vitrine will not follow file: links.";
  const fileCard = () => card({ url: "file:///etc/passwd" });

  it("is an alert on `O`, and `O` again replaces the node", async () => {
    renderApp(answers([fileCard()]));
    const article = await cardInHand();

    fireEvent.keyDown(article, { key: "o" });
    const first = await screen.findByRole("alert");
    expect(first.textContent).toBe(sentence);
    expect(screen.queryByRole("status")).toBeNull();

    fireEvent.keyDown(article, { key: "o" });
    const second = await screen.findByRole("alert");
    expect(second.textContent).toBe(sentence);
    expect(first.isConnected).toBe(false);
    expect(second).not.toBe(first);
  });

  it("is an alert on a click on the not-a-link address, and clicking again replaces the node", async () => {
    renderApp(answers([fileCard()]));
    await cardInHand();
    const address = screen.getByRole("button", { name: /not a link/ });

    fireEvent.click(address);
    const first = await screen.findByRole("alert");
    expect(first.textContent).toBe(sentence);

    fireEvent.click(address);
    const second = await screen.findByRole("alert");
    expect(first.isConnected).toBe(false);
    expect(second).not.toBe(first);
  });

  it("is forgotten by an act key that stays on the card", async () => {
    renderApp(answers([fileCard()], { "scouts.accept": refuse }));
    const article = await cardInHand();
    fireEvent.keyDown(article, { key: "o" });
    expect((await screen.findByRole("alert")).textContent).toBe(sentence);

    fireEvent.keyDown(article, { key: "a" });

    // The address refusal is gone; the line now holds the accept's own.
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(refused)
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});
