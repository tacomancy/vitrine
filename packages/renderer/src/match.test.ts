import { describe, expect, it } from "vitest";
import { matchKey, matchRun, strength } from "./match";

// The renderer's half of the Global command's match (ADR 0027 decisions 5
// and 6). The rungs themselves are the core's too; what only exists here is
// the run to mark, which has to point back into the name as it is written
// rather than into the key it was matched through.

describe("the form a Display name and a query are compared in", () => {
  it("lowercases, drops apostrophes and makes every other punctuation run one space", () => {
    expect(matchKey("Sleep's role — REM/NREM?")).toBe("sleeps role rem nrem");
  });

  it("keeps letters outside ASCII, so an umlaut is not punctuation", () => {
    expect(matchKey("Müller & Bäumler 2019")).toBe("müller bäumler 2019");
  });
});

describe("how well a name answers the query", () => {
  const of = (query: string, display: string) =>
    strength(matchKey(query), matchKey(display));

  it("ranks exact, then prefix, then a word start, then a bare contains", () => {
    expect(of("is replay necessary", "Is replay necessary?")).toBe(3);
    expect(of("is replay", "Is replay necessary?")).toBe(2);
    expect(of("necessary", "Is replay necessary?")).toBe(1);
    expect(of("eplay", "Is replay necessary?")).toBe(0);
  });

  it("is every name equally before a character is typed", () => {
    expect(of("", "Is replay necessary?")).toBe(0);
  });
});

describe("the run to mark", () => {
  it("is the span of the name the query matched, as the name is written", () => {
    const run = matchRun("Does slow-wave density predict recall?", "density");
    expect(run).not.toBeNull();
    const [from, to] = run!;
    expect("Does slow-wave density predict recall?".slice(from, to)).toBe(
      "density"
    );
  });

  it("spans the punctuation a query typed across it does not have", () => {
    const name = "Is slow-wave density the thing?";
    const run = matchRun(name, "slow wave density");
    expect(run).not.toBeNull();
    const [from, to] = run!;
    expect(name.slice(from, to)).toBe("slow-wave density");
  });

  it("is nothing when the query is empty or the name does not hold it", () => {
    expect(matchRun("Is replay necessary?", "")).toBeNull();
    expect(matchRun("Is replay necessary?", "spindle")).toBeNull();
  });
});
