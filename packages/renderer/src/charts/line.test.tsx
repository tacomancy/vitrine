import { cleanup, render, screen } from "@testing-library/react";
import type { AcceptRate, AcceptWeek } from "core";
import { afterEach, describe, expect, it } from "vitest";
import { AcceptLine } from "./line";

afterEach(cleanup);

// The accept-rate line (#516; ADR 0042 decision 2): a point only for a week
// that rests on five triaged items, a gap otherwise, never a zero.

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-30T12:00:00Z");
/** Twelve weeks, oldest first, from `{ triaged, rate }` for the weeks that have any; the rest are empty gaps. */
const weeks = (
  filled: Record<number, { triaged: number; rate: number | null }> = {}
): AcceptWeek[] =>
  Array.from({ length: 12 }, (_, i) => ({
    start: new Date(NOW - (12 - i) * 7 * DAY).toISOString(),
    triaged: 0,
    rate: null,
    ...filled[i],
  }));
const HEADLINE: AcceptRate = {
  kind: "rate",
  accepted: 30,
  triaged: 48,
  rate: 0.625,
};
const points = () => screen.queryAllByRole("img", { name: /triaged/ });

describe("the accept-rate line", () => {
  it("draws a point for a week with five items and none for a week with four", () => {
    render(
      <AcceptLine
        weeks={weeks({
          9: { triaged: 4, rate: null },
          10: { triaged: 5, rate: 0.8 },
          11: { triaged: 8, rate: 0.5 },
        })}
        headline={HEADLINE}
      />
    );

    expect(points().map((p) => p.getAttribute("aria-label"))).toEqual([
      "week of Sep 16: 80% of 5 triaged",
      "week of Sep 23: 50% of 8 triaged",
    ]);
  });

  it("gives each point its n on hover and to a screen reader", () => {
    render(
      <AcceptLine
        weeks={weeks({ 11: { triaged: 5, rate: 0.8 } })}
        headline={HEADLINE}
      />
    );

    const [point] = points();
    expect(point!.getAttribute("aria-label")).toContain("5 triaged");
    expect(point!.querySelector("title")?.textContent).toBe(
      "week of Sep 23: 80% of 5 triaged"
    );
  });

  it("breaks the line at a gap rather than dropping it to zero", () => {
    const { container } = render(
      <AcceptLine
        weeks={weeks({
          0: { triaged: 6, rate: 0.5 },
          1: { triaged: 6, rate: 0.5 },
          2: { triaged: 2, rate: null },
          3: { triaged: 6, rate: 0.5 },
          4: { triaged: 6, rate: 0.5 },
        })}
        headline={HEADLINE}
      />
    );

    const segments = [...container.querySelectorAll("path[data-line]")];
    expect(segments).toHaveLength(2);
    // A zero would put a point on the baseline; nothing is drawn there.
    expect(points()).toHaveLength(4);
  });

  it("states the window's headline beside the line", () => {
    render(
      <AcceptLine
        weeks={weeks({ 11: { triaged: 5, rate: 0.8 } })}
        headline={HEADLINE}
      />
    );

    expect(screen.getByText("63% over 12 weeks · 48 triaged")).toBeDefined();
  });

  it("draws no line for a Scout with fewer than five items in any week, and says why", () => {
    render(
      <AcceptLine
        weeks={weeks({ 11: { triaged: 3, rate: null } })}
        headline={{ kind: "rate", accepted: 2, triaged: 3, rate: 2 / 3 }}
      />
    );

    expect(points()).toHaveLength(0);
    expect(
      screen.getByText(
        "No week has five triaged items yet, so there is no line."
      )
    ).toBeDefined();
  });

  it("says nothing triaged yet for a Scout nobody has judged", () => {
    render(
      <AcceptLine weeks={weeks()} headline={{ kind: "nothing triaged" }} />
    );

    expect(screen.getByText("Nothing triaged yet.")).toBeDefined();
  });

  it("gives the reason, and no line, when the rate cannot be said", () => {
    render(
      <AcceptLine
        weeks={weeks({ 11: { triaged: 9, rate: 0.5 } })}
        headline={{ kind: "unavailable", reason: "Most papers lack authors." }}
      />
    );

    expect(screen.getByText("Most papers lack authors.")).toBeDefined();
    expect(points()).toHaveLength(0);
  });
});
