import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { TriedPage, TriedPages } from "core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  sessionStorage.clear();
});

// #912 (spec #909; ADR 0056 decisions 10 and 13): one *try* reads every
// Address and draws each page's answer under it, then one summed first look.
// The core is faked; that it reads each page is `scout-form.watched.test.ts`.

const RESEARCH = "https://lab.example/research";
const NEWS = "https://lab.example/news";
const BLOG = "https://lab.example/blog";
const FAILED =
  "The page answered with an error (HTTP 404) or was too large to read, so nothing was checked.";
const NO_KEY = "No model key is stored, so this page has not been read yet.";

const model = (
  title: string,
  projection: { costUsd: number; itemPages: number } | null
): TriedPage => ({
  outcome: "found",
  via: "model",
  total: 24,
  verified: 24,
  dropped: 0,
  titles: [title],
  tokens: { input: 2400, output: 420 },
  costUsd: 0.0123,
  cards: [],
  projection,
  itemPagesUnfetched: 0,
});
const feed = (title: string): TriedPage => ({
  outcome: "found",
  via: "feed",
  total: 14,
  titles: [title],
});

async function open(answer: Record<string, TriedPage>) {
  const asked: string[][] = [];
  window.location.hash = "#/scout-management/new";
  renderApp({
    "vault.current": vault,
    "scouts.list": { scouts: [], unreadable: [], dropped: [] },
    "scouts.health": { scouts: [], unreadable: [] },
    "questions.list": { questions: [], partial: [], unreadable: [], shape: [] },
    "settings.get": {},
    "scouts.tryWatched": ({ addresses }: { addresses: string[] }) => {
      asked.push(addresses);
      return addresses.map((address) => ({
        address,
        tried: answer[address]!,
      })) satisfies TriedPages;
    },
  });
  await screen.findByRole("form", { name: "New Scout" });
  fireEvent.change(screen.getByLabelText("Watching"), {
    target: { value: "watched" },
  });
  return asked;
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const list = (...urls: string[]) =>
  urls.forEach((url, at) => {
    if (at > 0) {
      fireEvent.click(
        screen.getByRole("button", { name: "add another address" })
      );
    }
    type(`Address ${at + 1}`, url);
  });
const tryIt = () =>
  fireEvent.click(screen.getByRole("button", { name: "Try" }));
/** What is drawn under one page's address in the tried list. */
const under = (address: string) =>
  within(screen.getByRole("list", { name: "Pages tried" }))
    .getByText(address)
    .closest("li")!;

describe("trying a Scout of several pages", () => {
  it("tries every address and draws each answer under its own, a failing page beside the others", async () => {
    const asked = await open({
      [RESEARCH]: model("A research paper", { costUsd: 1.2, itemPages: 24 }),
      [NEWS]: feed("A news post"),
      [BLOG]: { outcome: "failed", sentence: FAILED },
    });
    list(RESEARCH, ` ${NEWS}`, BLOG);

    tryIt();

    await screen.findByRole("list", { name: "Pages tried" });
    expect(asked).toEqual([[RESEARCH, NEWS, BLOG]]);
    expect(under(RESEARCH).textContent).toContain(
      "24 found · 24 verified · 0 dropped"
    );
    expect(within(under(RESEARCH)).getByText("A research paper")).toBeDefined();
    expect(
      within(under(RESEARCH)).getByText("≈ $1.20 for 24 item pages")
    ).toBeDefined();
    expect(under(NEWS).textContent).toContain(
      "14 found · a feed was found · no model call"
    );
    expect(within(under(NEWS)).getByText("A news post")).toBeDefined();
    expect(within(under(BLOG)).getByRole("alert").textContent).toBe(FAILED);
  });

  it("sums the known first looks, a feed's at nothing, and names a page whose cost is not known", async () => {
    await open({
      [RESEARCH]: model("A", { costUsd: 1.2, itemPages: 24 }),
      [NEWS]: model("B", { costUsd: 0.3, itemPages: 6 }),
      [BLOG]: feed("C"),
      "https://lab.example/talks": model("D", null),
      "https://lab.example/gone": { outcome: "failed", sentence: FAILED },
    });
    list(
      RESEARCH,
      NEWS,
      BLOG,
      "https://lab.example/talks",
      "https://lab.example/gone"
    );

    tryIt();

    expect((await screen.findByText(/for the first look at/)).textContent).toBe(
      "≈ $1.50 for the first look at 3 pages · not known for https://lab.example/talks and https://lab.example/gone"
    );
  });

  it("says the first look's cost is not known when no page's is", async () => {
    await open({
      [RESEARCH]: { outcome: "failed", sentence: FAILED },
      [NEWS]: model("B", null),
    });
    list(RESEARCH, NEWS);

    tryIt();

    expect((await screen.findByText(/first look's cost/)).textContent).toBe(
      `The first look's cost is not known for ${RESEARCH} and ${NEWS}.`
    );
  });

  // A feed needs no key; the way to Settings is one act, so one button.
  it("offers Add a key once, however many pages need one", async () => {
    await open({
      [RESEARCH]: { outcome: "no-key", sentence: NO_KEY },
      [NEWS]: { outcome: "no-key", sentence: NO_KEY },
      [BLOG]: feed("C"),
    });
    list(RESEARCH, NEWS, BLOG);

    tryIt();

    await screen.findByRole("list", { name: "Pages tried" });
    expect(within(under(RESEARCH)).getByRole("alert").textContent).toBe(NO_KEY);
    expect(within(under(NEWS)).getByRole("alert").textContent).toBe(NO_KEY);
    expect(screen.getAllByRole("button", { name: "Add a key" })).toHaveLength(
      1
    );
  });

  it("draws one page as it always has: no list of pages and no summed line", async () => {
    await open({
      [RESEARCH]: model("A", { costUsd: 1.2, itemPages: 24 }),
    });
    list(RESEARCH);

    tryIt();

    expect(await screen.findByText("≈ $1.20 for 24 item pages")).toBeDefined();
    expect(screen.queryByRole("list", { name: "Pages tried" })).toBeNull();
    expect(screen.queryByText(/for the first look at/)).toBeNull();
  });

  it("waits to try a page listed twice, and says why", async () => {
    const asked = await open({});
    list(RESEARCH, RESEARCH);

    const tryButton = screen.getByRole<HTMLButtonElement>("button", {
      name: "Try",
    });
    expect(tryButton.disabled).toBe(true);
    expect(screen.getByText("Try needs each page once.")).toBeDefined();
    tryIt();
    await waitFor(() => expect(asked).toEqual([]));
  });

  it("forgets every page's answer when an address changes", async () => {
    await open({
      [RESEARCH]: feed("A"),
      [NEWS]: feed("B"),
    });
    list(RESEARCH, NEWS);
    tryIt();
    await screen.findByRole("list", { name: "Pages tried" });

    type("Address 2", BLOG);

    expect(screen.queryByRole("list", { name: "Pages tried" })).toBeNull();
  });
});
