import { cleanup, render, screen } from "@testing-library/react";
import type { AcceptRate } from "core";
import { afterEach, describe, expect, it } from "vitest";
import { rateOver, weeksOf } from "../fake-core";
import { AcceptLine } from "./line";

afterEach(cleanup);

// The accept-rate line (#516; ADR 0042 decision 2): a point only for a week
// that rests on five triaged items, a gap otherwise, never a zero. The core has
// already decided which weeks are points; the chart draws what it is handed.

const points = () => screen.queryAllByRole("img", { name: /triaged/ });

describe("the accept-rate line", () => {
  it("draws a point for a week with five items and none for a week with four", () => {
    render(
      <AcceptLine
        rate={rateOver(
          10,
          17,
          weeksOf({
            9: { triaged: 4, rate: null },
            10: { triaged: 5, rate: 0.8 },
            11: { triaged: 8, rate: 0.5 },
          })
        )}
      />
    );

    expect(points().map((p) => p.getAttribute("aria-label"))).toEqual([
      "week of 1 Jul: 80% of 5 triaged",
      "week of 8 Jul: 50% of 8 triaged",
    ]);
  });

  it("gives each point its n on hover and to a screen reader", () => {
    render(
      <AcceptLine
        rate={rateOver(4, 5, weeksOf({ 11: { triaged: 5, rate: 0.8 } }))}
      />
    );

    const [point] = points();
    expect(point!.getAttribute("aria-label")).toContain("5 triaged");
    expect(point!.querySelector("title")?.textContent).toBe(
      "week of 8 Jul: 80% of 5 triaged"
    );
  });

  it("breaks the line at a gap rather than dropping it to zero", () => {
    const { container } = render(
      <AcceptLine
        rate={rateOver(
          12,
          26,
          weeksOf({
            0: { triaged: 6, rate: 0.5 },
            1: { triaged: 6, rate: 0.5 },
            2: { triaged: 2, rate: null },
            3: { triaged: 6, rate: 0.5 },
            4: { triaged: 6, rate: 0.5 },
          })
        )}
      />
    );

    // One subpath for each run of points on either side of the gap, and a
    // point for each week that has one: nothing is drawn for the gap itself.
    const d = container.querySelector("path[data-line]")!.getAttribute("d")!;
    expect(d.match(/M/g)).toHaveLength(2);
    expect(points()).toHaveLength(4);
  });

  it("draws a real 0% at the baseline, which is a different thing from a gap", () => {
    render(
      <AcceptLine
        rate={rateOver(0, 5, weeksOf({ 11: { triaged: 5, rate: 0 } }))}
      />
    );

    expect(points().map((p) => p.getAttribute("aria-label"))).toEqual([
      "week of 8 Jul: 0% of 5 triaged",
    ]);
  });

  it("states the window's headline beside the line", () => {
    render(
      <AcceptLine
        rate={rateOver(30, 48, weeksOf({ 11: { triaged: 5, rate: 0.8 } }))}
      />
    );

    expect(screen.getByText("63% over 12 weeks · 48 triaged")).toBeDefined();
  });

  it("draws no line for a Scout with fewer than five items in any week, and says why", () => {
    render(
      <AcceptLine
        rate={rateOver(2, 3, weeksOf({ 11: { triaged: 3, rate: null } }))}
      />
    );

    expect(points()).toHaveLength(0);
    expect(
      screen.getByText(
        "No week has 5 or more triaged items yet, so there is no line."
      )
    ).toBeDefined();
  });

  it("says nothing triaged yet for a Scout nobody has judged", () => {
    render(<AcceptLine rate={{ kind: "nothing triaged" }} />);

    expect(screen.getByText("Nothing triaged yet.")).toBeDefined();
  });

  it("gives the reason, and no line, when the rate cannot be said", () => {
    const unavailable: AcceptRate = {
      kind: "unavailable",
      reason: "Most papers lack authors.",
    };
    render(<AcceptLine rate={unavailable} />);

    expect(screen.getByText("Most papers lack authors.")).toBeDefined();
    expect(points()).toHaveLength(0);
  });
});
