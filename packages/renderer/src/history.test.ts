import type { Revision } from "core";
import { describe, expect, it } from "vitest";
import { historyRows, quietLabel, rangeLabel } from "./history";

// The history's arithmetic (spec #206 story 37): which entries are the
// narrative, which collapse into a trail, and what a Revision moved the
// field *to* — which the file never says, because an entry holds only what
// it moved *from*.

const at = (date: string): string => `${date}T10:00:00+02:00`;

const revision = (
  date: string,
  why: string | null,
  from: string
): Revision => ({
  at: at(date),
  field: "working answer",
  why,
  from,
});

describe("historyRows", () => {
  it("runs of quiet entries collapse, explained ones stand alone, in file order", () => {
    const entries = [
      revision("2026-08-05", "Cordi's funnel plot.", "Probably both."),
      revision("2026-07-02", null, "Mostly consolidation."),
      revision("2026-06-20", null, "Consolidation."),
      revision("2026-02-19", "First real position.", ""),
    ];
    const rows = historyRows(entries, {
      "working answer": "A third the size.",
    });
    expect(rows.map((row) => row.kind)).toEqual([
      "explained",
      "quiet",
      "explained",
    ]);
    expect(rows[1]).toEqual({ kind: "quiet", revisions: entries.slice(1, 3) });
  });

  it("each entry carries the text it moved the field to: the next newer entry's from, or the field as it stands now", () => {
    const entries = [
      revision("2026-08-05", "Later.", "Probably both."),
      revision("2026-02-19", "First.", ""),
    ];
    const rows = historyRows(entries, {
      "working answer": "A third the size.",
    });
    expect(
      rows.map((row) => (row.kind === "explained" ? row.to : null))
    ).toEqual(["A third the size.", "Probably both."]);
  });

  it("the chain is per field: another field's entry does not stand between two of this one's", () => {
    const entries: Revision[] = [
      { at: at("2026-08-05"), field: "claim", why: "c", from: "old claim" },
      revision("2026-07-02", "Later.", "Probably both."),
      revision("2026-02-19", "First.", ""),
    ];
    const rows = historyRows(entries, {
      "working answer": "A third the size.",
    });
    expect(
      rows.map((row) => (row.kind === "explained" ? row.to : null))
    ).toEqual(["", "A third the size.", "Probably both."]);
  });

  it("no entries is no rows", () => {
    expect(historyRows([], {})).toEqual([]);
  });
});

describe("quietLabel", () => {
  it("counts the run and spans it in the coarsest unit that is not a lie", () => {
    const span = (from: string, to: string) =>
      quietLabel([revision(to, null, ""), revision(from, null, "")]);
    expect(span("2026-06-20", "2026-08-02")).toBe(
      "2 quiet revisions over 6 weeks"
    );
    expect(span("2026-07-30", "2026-08-02")).toBe(
      "2 quiet revisions over 3 days"
    );
    expect(span("2026-02-19", "2026-08-02")).toBe(
      "2 quiet revisions over 5 months"
    );
    expect(span("2024-02-19", "2026-08-02")).toBe(
      "2 quiet revisions over 2 years"
    );
  });

  it("one revision, or a run inside one day, is a count with no span to claim", () => {
    expect(quietLabel([revision("2026-08-02", null, "")])).toBe(
      "1 quiet revision"
    );
    expect(
      quietLabel([
        revision("2026-08-02", null, "a"),
        revision("2026-08-02", null, "b"),
      ])
    ).toBe("2 quiet revisions");
  });
});

describe("rangeLabel", () => {
  it("says the year once inside one year, and both when a run crosses one", () => {
    expect(rangeLabel(at("2026-06-20"), at("2026-07-21"))).toBe(
      "20 Jun – 21 Jul 2026"
    );
    expect(rangeLabel(at("2025-12-30"), at("2026-01-04"))).toBe(
      "30 December 2025 – 4 January 2026"
    );
  });
});
