import { outline } from "markdown";
import { describe, expect, it } from "vitest";
import {
  coalesce,
  formatRevision,
  parseRevision,
  readRevisions,
  type Revision,
} from "./position-history.js";
import { localIso } from "./questions.js";

// The Revision grammar (ADR 0020 decision 1; docs/architecture.md § Vault
// layout, Position history): one list item per entry, `why:` and `from:`
// indented two spaces, the previous text one level further in. Pure format
// ↔ parse, pinned by a table so beats 3 and 4 inherit it with their fields.

const table: Array<{ name: string; revision: Revision; text: string }> = [
  {
    name: "a quiet entry with one line of previous text",
    revision: {
      at: "2026-07-02T09:10:00+02:00",
      field: "working answer",
      why: null,
      from: "Probably both.",
    },
    text: [
      "- 2026-07-02T09:10:00+02:00 · working answer",
      "  from:",
      "    Probably both.",
    ].join("\n"),
  },
  {
    name: "an empty from: — the field was empty before",
    revision: {
      at: "2026-07-02T09:10:00+02:00",
      field: "working answer",
      why: null,
      from: "",
    },
    text: ["- 2026-07-02T09:10:00+02:00 · working answer", "  from:"].join(
      "\n"
    ),
  },
  {
    name: "a why with links inline, and multi-paragraph previous text with blank lines",
    revision: {
      at: "2026-08-05T14:22:00+02:00",
      field: "working answer",
      why: "Cordi's funnel plot — the effect is mostly small-study bias. [[cordi2021#^h12]]",
      from: "Probably both, but the dissociation designs that could separate them are\nunderpowered. The strongest case ...\n\nA second paragraph, still indented four spaces.",
    },
    text: [
      "- 2026-08-05T14:22:00+02:00 · working answer",
      "  why: Cordi's funnel plot — the effect is mostly small-study bias. [[cordi2021#^h12]]",
      "  from:",
      "    Probably both, but the dissociation designs that could separate them are",
      "    underpowered. The strongest case ...",
      "",
      "    A second paragraph, still indented four spaces.",
    ].join("\n"),
  },
  {
    name: "a why and an empty from:",
    revision: {
      at: "2026-08-05T14:22:00+02:00",
      field: "claim",
      why: "Sharpened after [[smith2024]].",
      from: "",
    },
    text: [
      "- 2026-08-05T14:22:00+02:00 · claim",
      "  why: Sharpened after [[smith2024]].",
      "  from:",
    ].join("\n"),
  },
  {
    name: "previous text that is itself a list",
    revision: {
      at: "2026-06-02T09:10:00+02:00",
      field: "working answer",
      why: null,
      from: "- one\n- two",
    },
    text: [
      "- 2026-06-02T09:10:00+02:00 · working answer",
      "  from:",
      "    - one",
      "    - two",
    ].join("\n"),
  },
];

describe("the Revision grammar", () => {
  for (const { name, revision, text } of table) {
    it(`formats and parses back: ${name}`, () => {
      expect(formatRevision(revision)).toBe(text);
      expect(parseRevision(text)).toEqual(revision);
    });
  }

  it("parses an entry as a CRLF file holds it: the reader never sees the writer's LF", () => {
    const crlf = table[2]!.text.replace(/\n/g, "\r\n");
    expect(parseRevision(crlf)).toEqual(table[2]!.revision);
  });

  it("does not parse what is not an entry: no timestamp, no field, no from:", () => {
    expect(parseRevision("- a note someone typed")).toBeNull();
    expect(parseRevision("- 2026-07-02T09:10:00+02:00")).toBeNull();
    expect(
      parseRevision("- 2026-07-02T09:10:00+02:00 · working answer")
    ).toBeNull();
    expect(
      parseRevision("- 2026-07-02T09:10:00+02:00 · working answer\n  why: x")
    ).toBeNull();
  });
});

describe("reading a section's entries off the outline", () => {
  it("reads the top-level items that parse, in file order, and skips what does not without losing its place", () => {
    const source = [
      "## Position history",
      "",
      table[2]!.text,
      table[0]!.text,
      "",
      "a line someone typed",
      "",
      "- not an entry",
      table[4]!.text,
      "",
      "## Next",
      "",
    ].join("\n");
    const parsed = outline(source);
    const heading = parsed.headings.find((h) => h.text === "Position history")!;
    const items = readRevisions(source, parsed, heading);
    expect(items.map((i) => i.revision)).toEqual([
      table[2]!.revision,
      table[0]!.revision,
      null,
      table[4]!.revision,
    ]);
    // Each item's range is the outline's: the text between them is theirs to keep.
    expect(source.slice(items[0]!.range.start, items[0]!.range.end)).toBe(
      table[2]!.text
    );
    expect(source.slice(items[2]!.range.start, items[2]!.range.end)).toBe(
      "- not an entry"
    );
  });
});

describe("coalescing (ADR 0020 decision 2)", () => {
  const minute = 60_000;
  const head: Revision = {
    at: "2026-09-21T10:00:00+02:00",
    field: "working answer",
    why: null,
    from: "before the first save",
  };
  const at = (offsetMinutes: number) =>
    new Date(Date.parse(head.at) + offsetMinutes * minute);

  it("a save inside the window re-stamps the head entry and keeps its from:", () => {
    expect(
      coalesce(
        head,
        { field: "working answer", from: "after the first save", at: at(10) },
        30 * minute
      )
    ).toEqual({
      coalesced: true,
      revision: { ...head, at: localIso(at(10)) },
    });
  });

  it("a save after the window, on another field, or over an explained head opens a new entry", () => {
    const fresh = {
      field: "working answer",
      from: "after the first save",
      at: at(31),
    };
    const window = 30 * minute;
    const opened = coalesce(head, fresh, window);
    expect(opened.coalesced).toBe(false);
    expect(opened.revision).toMatchObject({
      field: "working answer",
      why: null,
      from: "after the first save",
    });
    expect(
      coalesce(head, { ...fresh, at: at(10), field: "claim" }, window).coalesced
    ).toBe(false);
    expect(
      coalesce({ ...head, why: "explained" }, { ...fresh, at: at(10) }, window)
        .coalesced
    ).toBe(false);
    expect(coalesce(null, { ...fresh, at: at(10) }, window).coalesced).toBe(
      false
    );
  });

  it("a head whose timestamp does not parse is never re-stamped", () => {
    expect(
      coalesce(
        { ...head, at: "yesterday" },
        { field: "working answer", from: "x", at: at(1) },
        minute
      ).coalesced
    ).toBe(false);
  });
});
