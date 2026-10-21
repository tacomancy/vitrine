import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import type { CoreEvent, IngestSummary, VaultStatus } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearIngest, INGEST_FADE_MS } from "./ingest-line";
import { empty, renderApp, vault } from "./fake-core";

// The Ingest run's summary (#419; spec #416 stories 14–17, 58): one quiet
// footer line in the polite channel, on every surface, and the only
// notification there is. It fades on a clean run.

afterEach(() => {
  cleanup();
  clearIngest();
  vi.useRealTimers();
});
beforeEach(() => window.history.replaceState(null, "", "/#/inbox"));

const watched: VaultStatus = {
  indexing: null,
  watching: { ok: true, since: new Date(2026, 8, 28, 8, 40).toISOString() },
  current: { ok: true },
};

const answers = {
  "vault.current": vault,
  "vault.status": watched,
  "vault.pdfFault": null,
  "vault.kinds": [],
  "questions.list": empty,
  "globalCommand.destinations": { rows: [] },
};

const landed = (summary: IngestSummary): CoreEvent => ({
  type: "ingestLanded",
  runId: "r1",
  summary,
  sources: [],
});

const LINE = (s: IngestSummary) =>
  `${s.new} new · ${s.questions} questions · ${s.removed} removed · ${s.unmatched} could not be re-matched`;

describe("the Ingest summary line", () => {
  it("is not there until a run has landed something", async () => {
    renderApp(answers);
    await screen.findByRole("region", { name: "Question Inbox" });
    expect(screen.queryByText(/could not be re-matched/)).toBeNull();
  });

  it("says what landed in four counts, in the footer channel", async () => {
    const { stream } = renderApp(answers);
    await screen.findByRole("region", { name: "Question Inbox" });
    const summary = { new: 12, questions: 2, removed: 1, unmatched: 0 };
    act(() => stream.push(landed(summary)));
    const line = await screen.findByText(LINE(summary));
    // Polite: a status the app is in, never an alert (ADR 0033).
    expect(line.closest("[role=status]")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("contentinfo").textContent).toContain(
      LINE(summary)
    );
  });

  it("fades on a clean run and stays while something could not be re-matched", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { stream } = renderApp(answers);
    await vi.waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Question Inbox" })
      ).not.toBeNull()
    );
    const clean = { new: 3, questions: 0, removed: 0, unmatched: 0 };
    act(() => stream.push(landed(clean)));
    await screen.findByText(LINE(clean));
    act(() => void vi.advanceTimersByTime(INGEST_FADE_MS + 1));
    expect(screen.queryByText(LINE(clean))).toBeNull();

    const open = { new: 3, questions: 0, removed: 0, unmatched: 2 };
    act(() => stream.push(landed(open)));
    await screen.findByText(LINE(open));
    act(() => void vi.advanceTimersByTime(INGEST_FADE_MS * 10));
    expect(screen.queryByText(LINE(open))).not.toBeNull();
  });
});

// The run window (#556, #560): runs that land less than one fade apart are
// one burst and one line.
describe("the Ingest summary line across a burst", () => {
  const sum = (a: IngestSummary, b: IngestSummary): IngestSummary => ({
    new: a.new + b.new,
    questions: a.questions + b.questions,
    removed: a.removed + b.removed,
    unmatched: a.unmatched + b.unmatched,
  });
  const clean = { new: 3, questions: 1, removed: 0, unmatched: 0 };
  const more = { new: 4, questions: 0, removed: 2, unmatched: 0 };
  const open = { new: 1, questions: 0, removed: 0, unmatched: 2 };

  async function start() {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const rendered = renderApp(answers);
    await vi.waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Question Inbox" })
      ).not.toBeNull()
    );
    return rendered.stream;
  }
  const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

  it("sums two landings 3 s apart, as a status and never an alert", async () => {
    const stream = await start();
    act(() => stream.push(landed(clean)));
    await screen.findByText(LINE(clean));
    tick(3000);
    act(() => stream.push(landed(more)));
    const line = await screen.findByText(LINE(sum(clean, more)));
    expect(line.closest("[role=status]")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("starts the fade again from the last landing", async () => {
    const stream = await start();
    act(() => stream.push(landed(clean)));
    await screen.findByText(LINE(clean));
    tick(5000);
    act(() => stream.push(landed(more)));
    await screen.findByText(LINE(sum(clean, more)));
    tick(INGEST_FADE_MS - 1000);
    expect(screen.queryByText(LINE(sum(clean, more)))).not.toBeNull();
    tick(1001);
    expect(screen.queryByText(LINE(sum(clean, more)))).toBeNull();
  });

  it("keeps a line with something to decide, adds later runs, and opens the panel from it", async () => {
    const stream = await start();
    act(() => stream.push(landed(open)));
    await screen.findByText(LINE(open));
    tick(INGEST_FADE_MS - 1000);
    act(() => stream.push(landed(more)));
    const both = sum(open, more);
    const line = await screen.findByText(LINE(both));
    tick(INGEST_FADE_MS * 10);
    expect(screen.queryByText(LINE(both))).not.toBeNull();
    // The panel opens from the summed line, not only from the first run's.
    fireEvent.click(line.closest("button")!);
    await screen.findByRole("dialog", { name: "Could not be re-matched" });
  });

  it("replaces a line after the burst, one with something to decide included", async () => {
    const stream = await start();
    act(() => stream.push(landed(open)));
    await screen.findByText(LINE(open));
    tick(INGEST_FADE_MS + 1);
    act(() => stream.push(landed(more)));
    await screen.findByText(LINE(more));
    expect(screen.queryByText(LINE(sum(open, more)))).toBeNull();
    // No stale count carried: nothing left to decide, so no button and a fade.
    expect(screen.getByText(LINE(more)).closest("button")).toBeNull();
    tick(INGEST_FADE_MS + 1);
    expect(screen.queryByText(LINE(more))).toBeNull();
  });

  it("counts a Reader removal that lands inside a burst", async () => {
    const stream = await start();
    act(() => stream.push(landed(clean)));
    await screen.findByText(LINE(clean));
    tick(1000);
    const removal = { new: 0, questions: 0, removed: 1, unmatched: 0 };
    act(() => stream.push(landed(removal)));
    await screen.findByText(LINE(sum(clean, removal)));
  });

  it("has no panel when everything matched", async () => {
    const stream = await start();
    act(() => stream.push(landed(clean)));
    const line = await screen.findByText(LINE(clean));
    expect(line.closest("button")).toBeNull();
  });

  it("is cleared by a vault switch, with its burst", async () => {
    const stream = await start();
    act(() => stream.push(landed(clean)));
    await screen.findByText(LINE(clean));
    act(() => clearIngest());
    expect(screen.queryByText(LINE(clean))).toBeNull();
    tick(1000);
    act(() => stream.push(landed(more)));
    await screen.findByText(LINE(more));
  });
});
