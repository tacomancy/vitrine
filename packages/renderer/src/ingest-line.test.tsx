import { act, cleanup, screen } from "@testing-library/react";
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
beforeEach(() => window.history.replaceState(null, "", "/"));

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
