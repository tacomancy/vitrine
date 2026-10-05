import { cleanup, render, screen, within } from "@testing-library/react";
import type { Matrix as MatrixData } from "core";
import { afterEach, describe, expect, it } from "vitest";
import { addressOf } from "../kinds";
import { binOf, Matrix } from "./matrix";

afterEach(cleanup);

// The coverage matrix's drawing (#484; ADR 0041 decisions 3, 11, 12): the
// core has already cut and weighed; the chart draws what it is handed.

const DATA: MatrixData = {
  depth: 1,
  deepest: 1,
  rows: [
    {
      kind: "question",
      path: "q/Does sleep help?.md",
      question: "Does sleep help?",
      weight: 9,
      unresolved: [],
    },
    {
      kind: "research-question",
      path: "q/Why probing (RQ).md",
      question: "Why probing?",
      weight: 1,
      unresolved: [],
    },
  ],
  columns: [
    { canonical: "sleep", display: "Sleep", weight: 9 },
    { canonical: "probing", display: "Probing", weight: 1 },
  ],
  cells: [
    [8, 0],
    [3, 1],
  ],
  totals: { rows: 2, columns: 2 },
};

// A CSS Module's class name is hashed; the bin is the unhashed part of it.
const binClass = (el: Element) =>
  [...el.classList]
    .map((c) => /(?:^|_)(none|b[1-4])(?:_|$)/.exec(c)?.[1])
    .find((c) => c !== undefined);

describe("binOf", () => {
  it.each([
    [0, "none"],
    [1, "b1"],
    [2, "b2"],
    [3, "b2"],
    [4, "b3"],
    [7, "b3"],
    [8, "b4"],
    [40, "b4"],
  ])("puts %i in %s", (n, bin) => expect(binOf(n)).toBe(bin));
});

describe("the coverage matrix", () => {
  it("draws one cell per row and column shown, each with its bin class and its exact count", () => {
    render(<Matrix matrix={DATA} />);
    const grid = screen.getByRole("grid", { name: /coverage/i });
    const cells = within(grid).getAllByRole("gridcell");
    expect(cells).toHaveLength(4);
    expect(cells.map(binClass)).toEqual(["b4", "none", "b2", "b1"]);
    expect(cells.map((c) => c.getAttribute("aria-label"))).toEqual([
      "Does sleep help? · Sleep: 8 items",
      "Does sleep help? · Probing: 0 items",
      "Why probing? · Sleep: 3 items",
      "Why probing? · Probing: 1 item",
    ]);
    // Intensity is never colour alone: a non-empty cell prints its count.
    expect(cells.map((c) => c.textContent)).toEqual(["8", "", "3", "1"]);
  });

  it("states the bin edges in a legend whose swatches wear the same classes", () => {
    render(<Matrix matrix={DATA} />);
    const legend = screen.getByRole("list", { name: /legend/i });
    const items = within(legend).getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "none",
      "1",
      "2–3",
      "4–7",
      "8+",
    ]);
    expect(
      items.map((i) => binClass(i.querySelector("[data-swatch]")!))
    ).toEqual(["none", "b1", "b2", "b3", "b4"]);
  });

  it("opens a Question or a Research Question from its row label, and a column header names its Tag and does not link", () => {
    render(<Matrix matrix={DATA} />);
    const rows = screen.getAllByRole("rowheader");
    expect(rows.map((r) => r.querySelector("a")?.getAttribute("href"))).toEqual(
      DATA.rows.map((r) => addressOf(r.kind, r.path))
    );
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual(["Sleep", "Probing"]);
    expect(headers.every((h) => h.querySelector("a") === null)).toBe(true);
  });

  it("prints no number it cannot stand behind: no row or column total, only each cell's own count", () => {
    render(<Matrix matrix={DATA} />);
    const grid = screen.getByRole("grid");
    // 9 is a row weight and 9 a column weight in DATA; neither is drawn.
    expect(within(grid).queryByText("9")).toBeNull();
  });
});
