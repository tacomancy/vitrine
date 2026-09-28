import type { Revision } from "core";
import { describe, expect, it } from "vitest";
import {
  historyRows,
  hypothesisFilters,
  quietLabel,
  rangeLabel,
} from "./history";

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

  it("an edit after evidence is never collapsed into the trail, with a why or without, and its chain is its criterion's (TEST-5)", () => {
    const entries: Revision[] = [
      {
        at: at("2026-09-06"),
        field: "criterion C2",
        why: null,
        from: "### B ^c2",
      },
      {
        at: at("2026-09-05"),
        field: "criterion C2 · edited after evidence",
        why: null,
        from: "### A ^c2",
      },
      revision("2026-07-02", null, "Mostly consolidation."),
    ];
    const rows = historyRows(entries, {});
    expect(rows.map((row) => row.kind)).toEqual([
      "quiet",
      "explained",
      "quiet",
    ]);
    expect(rows[1]).toMatchObject({
      loud: "edited after evidence",
      to: "### B ^c2",
    });
    expect(rows[0]).toEqual({ kind: "quiet", revisions: entries.slice(0, 1) });
  });

  it("a criterion's chain runs by its number, so an entry made diagnostic still knows what it became", () => {
    const entries: Revision[] = [
      {
        at: at("2026-09-06"),
        field: "criterion D2",
        why: null,
        from: "### B ^c2\n\nrelationship:: diagnostic",
      },
      {
        at: at("2026-09-05"),
        field: "criterion C2 · edited after evidence",
        why: null,
        from: "### B ^c2\n\nrelationship:: confirming",
      },
    ];
    const rows = historyRows(entries, {});
    expect(rows[1]).toMatchObject({
      loud: "edited after evidence",
      to: "### B ^c2\n\nrelationship:: diagnostic",
    });
  });

  it("a criterion deleted after evidence is loud too, and says which", () => {
    const entries: Revision[] = [
      {
        at: at("2026-09-05"),
        field: "criterion F4 · deleted after evidence",
        why: null,
        from: "### Gone ^c4",
      },
    ];
    expect(historyRows(entries, {})).toEqual([
      {
        kind: "explained",
        revision: entries[0],
        to: "",
        loud: "deleted after evidence",
      },
    ]);
  });

  it("an Override and its void are loud, never in the quiet trail, with or without a why (#337, spec #327 story 50)", () => {
    const entries: Revision[] = [
      {
        at: at("2026-09-06"),
        field: "override voided",
        why: null,
        from: at("2026-09-05"),
      },
      {
        at: at("2026-09-05"),
        field: "override",
        why: null,
        from: "inconclusive",
      },
    ];
    expect(
      historyRows(entries, {}).map((row) =>
        row.kind === "explained" ? row.loud : row.kind
      )
    ).toEqual(["override voided", "override"]);
  });

  it("an Override is not a Position: an older one never reads a newer one's from as what it moved to", () => {
    const override = (day: string): Revision => ({
      at: at(day),
      field: "override",
      why: "call",
      from: "inconclusive",
    });
    const rows = historyRows(
      [override("2026-09-08"), override("2026-09-05")],
      {}
    );
    expect(
      rows.map((row) => (row.kind === "explained" ? row.to : null))
    ).toEqual(["", ""]);
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

describe("hypothesisFilters", () => {
  // One write's entries share its timestamp: a criterion's Revision, the
  // `· state` entry it caused directly above it (#334), and the void of an
  // Override it revised (#337).
  const entries: Revision[] = [
    { at: at("2026-09-09"), field: "design notes", why: null, from: "" },
    {
      at: at("2026-09-08"),
      field: "override voided",
      why: null,
      from: at("2026-09-07"),
    },
    { at: at("2026-09-08"), field: "state", why: null, from: "inconclusive" },
    {
      at: at("2026-09-08"),
      field: "criterion F2",
      why: null,
      from: "### F ^c2",
    },
    {
      at: at("2026-09-07"),
      field: "override",
      why: "partial",
      from: "inconclusive",
    },
    {
      at: at("2026-09-06"),
      field: "criterion C1 · edited after evidence",
      why: null,
      from: "### C ^c1",
    },
    { at: at("2026-09-05"), field: "criterion C1", why: null, from: "" },
    { at: at("2026-09-04"), field: "criteria", why: null, from: "### C ^c1" },
    { at: at("2026-09-01"), field: "claim", why: null, from: "" },
  ];
  const shown = (label: string) => {
    const filter = hypothesisFilters(entries).find((f) => f.label === label);
    return entries.filter((e) => filter!.shows(e)).map((e) => e.field);
  };

  it("offers the claim alone, criterion edits alone, and what decided the state", () => {
    expect(hypothesisFilters(entries).map((f) => f.label)).toEqual([
      "claim",
      "criterion edits",
      "what decided it",
    ]);
    expect(shown("claim")).toEqual(["claim"]);
    expect(shown("criterion edits")).toEqual([
      "criterion F2",
      "criterion C1 · edited after evidence",
      "criterion C1",
      "criteria",
    ]);
  });

  it("what decided it: each move of the state with the criterion Revision stamped beside it, and the Overrides", () => {
    expect(shown("what decided it")).toEqual([
      "override voided",
      "state",
      "criterion F2",
      "override",
    ]);
  });

  it("filters rows after the chain is computed, and a quiet run closes over the entries it hides", () => {
    const filter = hypothesisFilters(entries).find(
      (f) => f.label === "criterion edits"
    )!;
    const rows = historyRows(entries, {}, filter.shows);
    expect(rows).toEqual([
      { kind: "quiet", revisions: [entries[3]] },
      {
        kind: "explained",
        revision: entries[5],
        to: "",
        loud: "edited after evidence",
      },
      { kind: "quiet", revisions: [entries[6], entries[7]] },
    ]);
    // The claim's entry is the claim's first: it moved to the claim now,
    // not to a criterion's text the filter hid.
    const claim = hypothesisFilters(entries).find((f) => f.label === "claim")!;
    expect(historyRows(entries, { claim: "Now." }, claim.shows)).toEqual([
      { kind: "quiet", revisions: [entries[8]] },
    ]);
  });
});
