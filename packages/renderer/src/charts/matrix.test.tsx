import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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
  material: [
    [
      [
        { path: "s/a.md", kind: "source", display: "Paper A", tags: ["sleep"] },
        {
          path: "s/stub.md",
          kind: "source-stub",
          display: "Stub B",
          tags: ["sleep"],
        },
      ],
      [],
    ],
    [[], []],
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

// The matrix as an interface (#490; ADR 0041 decision 11; ADR 0030): one
// grid the keyboard walks by its chosen id, and a cell that opens its Material.

describe("the matrix as an interface", () => {
  const grid = () => screen.getByRole("grid", { name: /coverage/i });
  const key = (k: string) => fireEvent.keyDown(grid(), { key: k });
  const active = () =>
    document.getElementById(grid().getAttribute("aria-activedescendant")!);

  it("is one tab stop whose chosen cell is published as aria-activedescendant", () => {
    render(<Matrix matrix={DATA} />);
    expect(grid().tabIndex).toBe(0);
    expect(
      within(grid())
        .getAllByRole("gridcell")
        .every((c) => c.tabIndex === -1)
    ).toBe(true);
    fireEvent.focus(grid());
    expect(active()?.getAttribute("aria-label")).toBe(
      "Does sleep help? · Sleep: 8 items"
    );
  });

  it("walks cell to cell with the arrow keys and stops at the edges", () => {
    render(<Matrix matrix={DATA} />);
    fireEvent.focus(grid());
    key("ArrowRight");
    expect(active()?.getAttribute("aria-label")).toMatch(/Probing: 0/);
    key("ArrowRight");
    expect(active()?.getAttribute("aria-label")).toMatch(/Probing: 0/);
    key("ArrowDown");
    expect(active()?.getAttribute("aria-label")).toBe(
      "Why probing? · Probing: 1 item"
    );
    key("ArrowLeft");
    key("ArrowUp");
    expect(active()?.getAttribute("aria-label")).toMatch(/Sleep: 8/);
  });

  it("marks the chosen cell selected and prints its exact count, even when the cell is empty", () => {
    render(<Matrix matrix={DATA} />);
    fireEvent.focus(grid());
    key("ArrowRight");
    expect(active()?.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(/Probing: 0 items$/).textContent).toBe(
      "Does sleep help? · Probing: 0 items"
    );
  });

  it("opens the cell's Material on return and closes it on escape", () => {
    render(<Matrix matrix={DATA} />);
    fireEvent.focus(grid());
    expect(screen.queryByRole("list", { name: /material/i })).toBeNull();
    key("Enter");
    const list = screen.getByRole("list", {
      name: "Material: Does sleep help? · Sleep",
    });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(active()?.getAttribute("aria-expanded")).toBe("true");
    key("Escape");
    expect(screen.queryByRole("list", { name: /material/i })).toBeNull();
  });

  it("opens a Source in its Reader and names a stub without linking it", () => {
    render(<Matrix matrix={DATA} />);
    fireEvent.focus(grid());
    key("Enter");
    const list = screen.getByRole("list", { name: /material/i });
    const [source, stub] = within(list).getAllByRole("listitem");
    expect(source!.querySelector("a")?.getAttribute("href")).toBe(
      addressOf("source", "s/a.md")
    );
    expect(source!.textContent).toContain("Paper A");
    expect(stub!.querySelector("a")).toBeNull();
    expect(stub!.textContent).toContain("Stub B");
    expect(stub!.textContent).toMatch(/stub/i);
  });

  it("says so when an open cell holds nothing, and closes when the choice moves", () => {
    render(<Matrix matrix={DATA} />);
    fireEvent.focus(grid());
    key("ArrowRight");
    key("Enter");
    expect(screen.getByRole("list", { name: /material/i }).textContent).toMatch(
      /no material/i
    );
    key("ArrowLeft");
    expect(screen.queryByRole("list", { name: /material/i })).toBeNull();
  });

  it("opens by click as well, choosing the cell it was on", () => {
    render(<Matrix matrix={DATA} />);
    fireEvent.click(within(grid()).getAllByRole("gridcell")[0]!);
    expect(screen.getByRole("list", { name: /material/i })).toBeDefined();
  });
});
