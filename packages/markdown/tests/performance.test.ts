import { describe, expect, it } from "vitest";

import {
  cpuMs,
  LINEAR_PENALTY_BOUND,
  longParagraphPenalty,
} from "./performance.js";

// What the performance tests stand on (#538). Each instrument is shown to do
// what it claims on a stand-in whose cost is known, so that a test going red
// means the code under test and not the ruler.

/**
 * Fixed work, not a spin on the clock: a spin is descheduled under load and
 * would measure almost nothing, which is the case that matters. It returns what
 * it summed because that has to be read, or the engine may skip the loop.
 */
function spin(iterations: number): number {
  let sum = 0;
  for (let i = 0; i < iterations; i++) sum += i % 7;
  return sum;
}

describe("cpuMs", () => {
  const WAIT_MS = 300;

  it("does not count time the process spends waiting", () => {
    // A blocked thread costs no CPU however long it blocks, which is what a
    // loaded machine does to a runnable one: it makes it wait.
    const cell = new Int32Array(new SharedArrayBuffer(4));
    let outcome: string | undefined;
    const cpu = cpuMs(() => {
      // The cell holds 0 and nothing ever wakes it.
      outcome = Atomics.wait(cell, 0, 0, WAIT_MS);
    });

    // The wait has to have run its full length, or the bound below proves
    // nothing.
    expect(outcome).toBe("timed-out");
    expect(cpu).toBeLessThan(WAIT_MS / 3);
  });

  it("counts the work it is given", () => {
    let sum = 0;
    const cpu = cpuMs(() => {
      sum = spin(20_000_000);
    });

    expect(sum).toBeGreaterThan(0);
    expect(cpu).toBeGreaterThan(5);
  });
});

describe("longParagraphPenalty", () => {
  // Native work, so the engine cannot skip it, linear in the text however the
  // text is cut into paragraphs. Repeated until a run costs tens of
  // milliseconds: a ratio of two timings a few milliseconds long is mostly
  // noise.
  const linear = (markdown: string) => {
    let parsed: unknown;
    for (let pass = 0; pass < 20; pass++) {
      parsed = JSON.parse(JSON.stringify(markdown.split("\n")));
    }
    return parsed;
  };

  // A term quadratic in the lines of a paragraph, as micromark's merge was
  // before #196. Every 8th step only, so it costs ~100 ms on the long
  // paragraph and a few ms on the short ones: wide enough that a hiccup in
  // that baseline cannot bring the penalty near the bound. The count lives on
  // an object that is returned, so the engine cannot skip the loops.
  const quadratic = (markdown: string) => {
    const steps = { total: 0 };
    for (const paragraph of markdown.split("\n\n")) {
      const lines = paragraph.split("\n").length;
      for (let i = 0; i < lines; i++) {
        for (let j = 0; j < lines; j += 8) steps.total += j;
      }
    }
    return steps;
  };

  it("stays under the bound when the cost is linear in the text", () => {
    expect(longParagraphPenalty(linear)).toBeLessThan(LINEAR_PENALTY_BOUND);
  });

  it("goes past the bound when the cost is quadratic in a paragraph's lines", () => {
    expect(longParagraphPenalty(quadratic)).toBeGreaterThan(
      LINEAR_PENALTY_BOUND
    );
  });

  it("is not hidden by a baseline that pays for its first run", () => {
    // The first timing of real code includes compiling it, which cost the
    // baseline 1.7 s against 0.7 s once warm and took the penalty of a genuine
    // regression from 18 to 6 (#538). The first short run here pays ~80 ms of
    // fixed work, as much as the long run costs, so a baseline taken from it
    // alone puts the penalty near 1.
    let first = true;
    const quadraticOnItsFirstShortRun = (markdown: string) => {
      const steps = quadratic(markdown);
      if (first && markdown.includes("\n\n")) {
        first = false;
        steps.total += spin(100_000_000);
      }
      return steps;
    };

    expect(longParagraphPenalty(quadraticOnItsFirstShortRun)).toBeGreaterThan(
      LINEAR_PENALTY_BOUND
    );
  });
});
