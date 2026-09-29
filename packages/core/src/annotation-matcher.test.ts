import { describe, expect, it } from "vitest";
import {
  GEOMETRY_THRESHOLD,
  matchAnnotations,
  normalise,
  overlap,
  type Known,
  type LinkAnswer,
  type Present,
} from "./annotation-matcher.js";

// The matcher on its own (#420; spec #416 stories 34–44, 115–116). Every
// number below was read by the engine out of a fixture PDFKit saved — the
// values are Preview's, not invented — and the same behaviour is proved end
// to end in `ingest.rematch.test.ts`, so a threshold or a tier order that
// changes fails in both places.

const PARTICIPANTS = [[72, 691.2, 264.1, 691.2, 72, 679.2, 264.1, 679.2]];
const DIFFERENCE = [
  [115.4, 673.2, 329.4, 673.2, 115.4, 661.2, 329.4, 661.2],
  [72, 655.2, 159.4, 655.2, 72, 643.2, 159.4, 643.2],
];
const MEMORY = [[204.7, 709.2, 380.1, 709.2, 204.7, 697.2, 380.1, 697.2]];

const known = (over: Partial<Known> & { id: string }): Known => ({
  kind: "highlight",
  page: 0,
  quads: PARTICIPANTS,
  quote: "Participants who heard the odor cue",
  linkable: true,
  ...over,
});
const present = (over: Partial<Present> = {}): Present => ({
  kind: "highlight",
  page: 0,
  quads: PARTICIPANTS,
  quote: "Participants who heard the odor cue",
  ...over,
});

const linked =
  (answer: LinkAnswer = "unlinked") =>
  () =>
    answer;

/** Match and return each identity's outcome as a short string. */
function run(
  k: Known[],
  p: Present[],
  links: (k: Known) => LinkAnswer = linked()
) {
  const result = matchAnnotations({ known: k, present: p, links });
  return {
    ...result,
    says: result.outcomes.map((o) =>
      o.status === "matched"
        ? `${o.by}:${o.present}${o.quoteChanged ? "*" : ""}`
        : o.status === "unmatched"
          ? `unmatched(${o.reason})`
          : o.status
    ),
  };
}

describe("tier 1: object identity, confirmed by text", () => {
  it("wins when /NM names the identity and the text agrees, wherever the annotation now is", () => {
    const r = run(
      [known({ id: "a" })],
      [present({ nm: "a", quads: MEMORY, page: 1 })]
    );
    expect(r.says).toEqual(["object:0"]);
  });

  it("is not trusted when the text under the name has changed to another passage", () => {
    // The /NM survived but the highlight now covers a different sentence:
    // an id must never override the text, so this falls through and, finding
    // nothing at the old place either, is not matched at all.
    const r = run(
      [known({ id: "a" })],
      [
        present({
          nm: "a",
          quote: "different sentence about memory",
          quads: MEMORY,
          page: 1,
        }),
      ],
      linked("linked")
    );
    expect(r.says).toEqual(["unmatched(nothing)"]);
    expect(r.fresh).toEqual([0]);
  });

  it("needs the same kind of thing: a note carrying the name of a highlight is not it", () => {
    const r = run(
      [known({ id: "a" })],
      [present({ nm: "a", kind: "text" })],
      linked("linked")
    );
    expect(r.says).toEqual(["unmatched(nothing)"]);
  });
});

describe("tier 2: the quote on the same page", () => {
  it("finds a highlight Preview re-saved unchanged", () => {
    expect(run([known({ id: "a" })], [present()]).says).toEqual(["text:0"]);
  });

  it("finds the highlight when its text reflowed a line down", () => {
    const shifted = [[72, 673.2, 264.1, 673.2, 72, 661.2, 264.1, 661.2]];
    expect(
      run([known({ id: "a" })], [present({ quads: shifted })]).says
    ).toEqual(["text:0"]);
  });

  it("finds a nudged highlight by its text, not its place", () => {
    const nudged = [[73.5, 689.2, 265.6, 689.2, 73.5, 677.2, 265.6, 677.2]];
    expect(
      run([known({ id: "a" })], [present({ quads: nudged })]).says
    ).toEqual(["text:0"]);
  });

  it("wins over geometry: the same words elsewhere beat different words in the same place", () => {
    const r = run(
      [known({ id: "a" })],
      [
        present({ quote: "something else entirely" }),
        present({ quads: [[72, 500, 264.1, 500, 72, 488, 264.1, 488]] }),
      ]
    );
    expect(r.says).toEqual(["text:1"]);
    expect(r.fresh).toEqual([0]);
  });

  it("compares text after normalisation, on both sides", () => {
    const r = run(
      [known({ id: "a", quote: "Ef\u{FB01}cient   down-\nstream analyses" })],
      [present({ quote: "efficient downstream ANALYSES" })]
    );
    expect(r.says).toEqual(["text:0"]);
  });

  it("does not treat two empty quotes as equal text", () => {
    const r = run(
      [known({ id: "a", quote: "", quads: PARTICIPANTS })],
      [present({ quote: "", quads: [[300, 100, 400, 100, 300, 90, 400, 90]] })]
    );
    expect(r.says).toEqual(["removed"]);
  });
});

describe("tier 3: the quote on any page", () => {
  it("follows a passage to the page a re-export moved it to", () => {
    const r = run(
      [known({ id: "a" })],
      [
        present({
          page: 1,
          quads: [[72, 300, 264.1, 300, 72, 288, 264.1, 288]],
        }),
      ]
    );
    expect(r.says).toEqual(["text-moved:0"]);
  });

  it("is reached only after the same page has had its chance", () => {
    const r = run(
      [known({ id: "a" })],
      [
        present({ page: 1, quads: PARTICIPANTS }),
        present({
          page: 0,
          quads: [[72, 300, 264.1, 300, 72, 288, 264.1, 288]],
        }),
      ]
    );
    expect(r.says).toEqual(["text:1"]);
  });
});

describe("tier 4: geometry", () => {
  it.each([
    [
      "extended",
      "Participants who heard the odor cue recalled more",
      [[72, 691.2, 340.1, 691.2, 72, 679.2, 340.1, 679.2]],
    ],
    [
      "trimmed",
      "Participants who heard the",
      [[72, 691.2, 214.1, 691.2, 72, 679.2, 214.1, 679.2]],
    ],
  ])(
    "finds a highlight the researcher %s, and says its quote changed",
    (_, quote, quads) => {
      expect(
        run([known({ id: "a" })], [present({ quote, quads })]).says
      ).toEqual(["geometry:0*"]);
    }
  );

  it("does not match the highlight on the next line, which shares no box", () => {
    const next = [[72, 673.2, 264.1, 673.2, 72, 661.2, 264.1, 661.2]];
    const r = run(
      [known({ id: "a" })],
      [present({ quote: "another line of text", quads: next })],
      linked("linked")
    );
    expect(r.says).toEqual(["unmatched(nothing)"]);
    expect(r.fresh).toEqual([0]);
  });

  it("holds its threshold at the edge", () => {
    expect(GEOMETRY_THRESHOLD).toBe(0.4);
    const box = (width: number) => [[0, 12, width, 12, 0, 0, width, 0]];
    const base = { id: "a", quote: "one", quads: box(100), linkable: true };
    // A box 100 wide inside one 250 wide is exactly 0.4 of it.
    expect(overlap(box(100), box(250))).toBeCloseTo(0.4);
    expect(
      run([known(base)], [present({ quote: "two", quads: box(250) })]).says
    ).toEqual(["geometry:0*"]);
    expect(
      run(
        [known(base)],
        [present({ quote: "two", quads: box(251) })],
        linked("linked")
      ).says
    ).toEqual(["unmatched(nothing)"]);
  });

  it("needs the same page, and the same kind", () => {
    const moved = run(
      [known({ id: "a" })],
      [present({ quote: "extended text", page: 1 })],
      linked("linked")
    );
    expect(moved.says).toEqual(["unmatched(nothing)"]);
    const other = run(
      [known({ id: "a" })],
      [present({ quote: "extended text", kind: "text" })],
      linked("linked")
    );
    expect(other.says).toEqual(["unmatched(nothing)"]);
  });

  it("matches ink, which has nothing but its box to judge by", () => {
    const stroke = [[100, 540, 220, 540, 100, 500, 220, 500]];
    const r = run(
      [
        known({
          id: "i",
          kind: "ink",
          quote: "",
          quads: stroke,
          linkable: false,
        }),
      ],
      [present({ kind: "stamp", quote: "", quads: stroke })]
    );
    expect(r.says).toEqual(["geometry:0"]);
  });
});

describe("ambiguity is a decision", () => {
  const twin = (y: number) => [[72, y + 12, 180, y + 12, 72, y, 180, y]];
  const TWIN = "Twin sentence here.";
  const first = { quote: TWIN, quads: twin(697.2) };
  const second = { quote: TWIN, quads: twin(679.2) };

  it("tells two identical highlights on one page apart by geometry", () => {
    const r = run(
      [known({ id: "a", ...first }), known({ id: "b", ...second })],
      [present(second), present(first)]
    );
    expect(r.says).toEqual(["text:1", "text:0"]);
    expect(r.held).toEqual([]);
  });

  it("does not let an unlinked twin be told from its sibling by luck when one is gone", () => {
    // The second twin was deleted. The first is the only candidate for both
    // identities, and nothing says which one it was.
    const r = run(
      [known({ id: "a", ...first }), known({ id: "b", ...second })],
      [present(first)]
    );
    expect(r.says).toEqual(["unmatched(ambiguous)", "unmatched(ambiguous)"]);
    expect(r.held).toEqual([0]);
    expect(r.fresh).toEqual([]);
  });

  it("is Unmatched, with its candidates held, when geometry cannot break the tie", () => {
    const r = run(
      [known({ id: "a", ...first })],
      [
        present({ quote: TWIN, quads: twin(500) }),
        present({ quote: TWIN, quads: twin(400) }),
      ]
    );
    expect(r.says).toEqual(["unmatched(ambiguous)"]);
    expect(r.held).toEqual([0, 1]);
    expect(r.fresh).toEqual([]);
  });

  it("is Unmatched for every identity that reaches the same tied candidates, not just the first", () => {
    const r = run(
      [known({ id: "a", ...first }), known({ id: "b", ...second })],
      [
        present({ quote: TWIN, quads: twin(500) }),
        present({ quote: TWIN, quads: twin(400) }),
      ]
    );
    expect(r.says).toEqual(["unmatched(ambiguous)", "unmatched(ambiguous)"]);
    expect(r.held).toEqual([0, 1]);
    expect(r.fresh).toEqual([]);
  });

  it("is Unmatched even when nothing links to it: the one way an unlinked identity reaches the panel", () => {
    const r = run(
      [known({ id: "a", ...first })],
      [
        present({ quote: TWIN, quads: twin(500) }),
        present({ quote: TWIN, quads: twin(400) }),
      ],
      linked("unlinked")
    );
    expect(r.says).toEqual(["unmatched(ambiguous)"]);
  });

  it("claims a candidate once: an object match keeps it from a text match", () => {
    const r = run(
      [
        known({ id: "a" }),
        known({ id: "b", quads: [[72, 300, 264.1, 300, 72, 288, 264.1, 288]] }),
      ],
      [present({ nm: "b" })]
    );
    // `b` is named, so it takes the annotation at tier 1; `a` finds no other
    // candidate of its own and is not handed the same one.
    expect(r.says[1]).toBe("object:0");
    expect(r.says[0]).toBe("removed");
  });

  it("does not hold a contested annotation for ink, which no row could show", () => {
    const stroke = [[100, 540, 220, 540, 100, 500, 220, 500]];
    const r = run(
      [
        known({
          id: "i",
          kind: "ink",
          quote: "",
          quads: stroke,
          linkable: false,
        }),
        known({
          id: "j",
          kind: "ink",
          quote: "",
          quads: stroke,
          linkable: false,
        }),
      ],
      [present({ kind: "ink", quote: "", quads: stroke })]
    );
    expect(r.says).toEqual(["removed", "removed"]);
    expect(r.held).toEqual([]);
    expect(r.fresh).toEqual([0]);
  });
});

describe("tier 5: removed against Unmatched", () => {
  const gone = (answer: LinkAnswer) =>
    run([known({ id: "a" })], [], linked(answer)).says;

  it("removes an identity nothing links to", () => {
    expect(gone("unlinked")).toEqual(["removed"]);
  });

  it("makes an identity something links to Unmatched", () => {
    expect(gone("linked")).toEqual(["unmatched(nothing)"]);
  });

  it("makes an identity whose links cannot be established Unmatched, never removed", () => {
    expect(gone("unknown")).toEqual(["unmatched(nothing)"]);
  });

  it("never asks about an identity that could not be linked to", () => {
    const asked: string[] = [];
    const r = run(
      [known({ id: "i", kind: "ink", quote: "", linkable: false })],
      [],
      (k) => {
        asked.push(k.id);
        return "linked";
      }
    );
    expect(r.says).toEqual(["removed"]);
    expect(asked).toEqual([]);
  });

  it("asks only about identities every tier failed", () => {
    const asked: string[] = [];
    run(
      [known({ id: "a" }), known({ id: "b", quads: MEMORY, quote: "zz" })],
      [present()],
      (k) => {
        asked.push(k.id);
        return "unlinked";
      }
    );
    expect(asked).toEqual(["b"]);
  });
});

describe("what takes no part", () => {
  it("skips a retired identity: a Tombstone that matched would be raised again on every Ingest", () => {
    const r = run([known({ id: "a", retired: true })], [present()]);
    expect(r.says).toEqual(["skipped"]);
    expect(r.fresh).toEqual([0]);
  });

  it("names as new every annotation no identity wanted", () => {
    const r = run(
      [known({ id: "a" })],
      [present(), present({ quote: "new one", quads: MEMORY, page: 1 })]
    );
    expect(r.fresh).toEqual([1]);
  });
});

describe("the fixtures' own values", () => {
  it("re-saved: every highlight is found by text", () => {
    const r = run(
      [
        known({ id: "h1" }),
        known({
          id: "h2",
          quads: DIFFERENCE,
          quote: "difference was reliable across the downstream analyses",
        }),
        known({
          id: "h4",
          page: 1,
          quads: MEMORY,
          quote: "different sentence about memory",
        }),
      ],
      [
        present({
          quads: DIFFERENCE,
          quote: "difference was reliable across the downstream analyses",
        }),
        present(),
        present({
          page: 1,
          quads: MEMORY,
          quote: "different sentence about memory",
        }),
      ]
    );
    expect(r.says).toEqual(["text:1", "text:0", "text:2"]);
  });
});

describe("normalise", () => {
  it.each([
    ["NFKC folds a ligature", "ef\u{FB01}cient", "efficient"],
    ["a hyphen at a line end joins the words", "down-\nstream", "downstream"],
    ["a hyphen inside a line stays", "well-known result", "well-known result"],
    ["whitespace collapses", "  a \t b\n c ", "a b c"],
    ["case folds", "Odor CUE", "odor cue"],
  ])("%s", (_, raw, expected) => {
    expect(normalise(raw)).toBe(expected);
  });
});
