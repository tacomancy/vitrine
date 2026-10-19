import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AttentionTag } from "core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Scatter } from "./scatter";

afterEach(cleanup);

// The attention scatter's drawing (#655; ADR 0045 decision 6, ADR 0030): the
// core has already judged and found the medians; the chart draws what it is
// handed and adds no number of its own.

const point = (tag: string, papers: number, growth: number): AttentionTag => ({
  tag,
  display: tag,
  papers,
  withText: papers,
  state: "measured",
  reason: null,
  growth,
  counts: { last12: 100, prior12: 100 },
  measuredAt: "2026-10-16T09:00:00.000Z",
  pending: false,
  query: 'filter=title_and_abstract.search:("a")',
  failure: null,
});

const TAGS = [
  point("crowded", 9, 1.5),
  point("blind", 2, 2),
  point("ahead", 8, -0.1),
  point("obscure", 1, 0.05),
];
const CROSSING = { placed: 4, papers: 5, growth: 0.75 };

const grid = () => screen.getByRole("listbox");

describe("the attention scatter", () => {
  it("draws one point per Tag with the count on it and an accessible label", () => {
    render(<Scatter tags={TAGS} crossing={CROSSING} onChoose={() => {}} />);
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(4);
    const blind = screen.getByRole("option", {
      name: "blind: 2 papers, growth +200%",
    });
    expect(blind.textContent).toContain("2");
    expect(
      screen.getByRole("option", { name: "ahead: 8 papers, growth −10%" })
    ).toBeDefined();
  });

  it("places points by papers held across and growth up", () => {
    render(<Scatter tags={TAGS} crossing={CROSSING} onChoose={() => {}} />);
    const at = (name: string) => {
      const circle = screen
        .getByRole("option", { name: new RegExp(`^${name}:`) })
        .querySelector("circle")!;
      return { x: +circle.getAttribute("cx")!, y: +circle.getAttribute("cy")! };
    };
    expect(at("crowded").x).toBeGreaterThan(at("blind").x);
    // SVG's y runs down: more growth is a smaller y.
    expect(at("blind").y).toBeLessThan(at("crowded").y);
    expect(at("crowded").y).toBeLessThan(at("ahead").y);
  });

  it("sizes a point by its papers", () => {
    render(<Scatter tags={TAGS} crossing={CROSSING} onChoose={() => {}} />);
    const radius = (name: string) =>
      +screen
        .getByRole("option", { name: new RegExp(`^${name}:`) })
        .querySelector("circle")!
        .getAttribute("r")!;
    expect(radius("crowded")).toBeGreaterThan(radius("obscure"));
  });

  it("states the median the axes cross at, and names the four quadrants in text", () => {
    render(<Scatter tags={TAGS} crossing={CROSSING} onChoose={() => {}} />);
    expect(
      screen.getByText("axes cross at the median of 4 placed tags")
    ).toBeDefined();
    for (const name of [
      "Blind spot",
      "Crowded",
      "Ahead of the field, or a backwater",
      "Obscure",
    ]) {
      expect(screen.getByText(name)).toBeDefined();
    }
  });

  it("draws no quadrant, line or name under four placed Tags, and says so", () => {
    render(
      <Scatter tags={TAGS.slice(0, 3)} crossing={null} onChoose={() => {}} />
    );
    expect(screen.queryByText("Blind spot")).toBeNull();
    expect(document.querySelector("[data-quadrant-line]")).toBeNull();
    expect(
      screen.getByText(/fewer than 4 placed tags — no quadrants, ranked below/)
    ).toBeDefined();
  });

  it("draws nothing for a vault with no placed Tag, rather than an empty grid", () => {
    const { container } = render(
      <Scatter tags={[]} crossing={null} onChoose={() => {}} />
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("is one tab stop whose chosen point is only an id (ADR 0030)", () => {
    render(<Scatter tags={TAGS} crossing={CROSSING} onChoose={() => {}} />);
    const box = grid();
    expect(box.tabIndex).toBe(0);
    expect(box.getAttribute("aria-activedescendant")).toBeNull();
    fireEvent.focus(box);
    const first = box.getAttribute("aria-activedescendant")!;
    expect(document.getElementById(first)!.getAttribute("role")).toBe("option");
    fireEvent.keyDown(box, { key: "ArrowRight" });
    const second = box.getAttribute("aria-activedescendant")!;
    expect(second).not.toBe(first);
    expect(document.getElementById(second)!.getAttribute("aria-selected")).toBe(
      "true"
    );
    expect(document.getElementById(first)!.getAttribute("aria-selected")).toBe(
      "false"
    );
  });

  it("steps through the points by papers held, and Return opens the one it is on", () => {
    const onChoose = vi.fn();
    render(<Scatter tags={TAGS} crossing={CROSSING} onChoose={onChoose} />);
    const box = grid();
    fireEvent.focus(box);
    // obscure (1), blind (2), ahead (8), crowded (9)
    fireEvent.keyDown(box, { key: "ArrowRight" });
    fireEvent.keyDown(box, { key: "ArrowRight" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onChoose).toHaveBeenCalledWith("ahead");
    fireEvent.keyDown(box, { key: "ArrowLeft" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onChoose).toHaveBeenLastCalledWith("blind");
  });

  it("opens a Tag on a click", () => {
    const onChoose = vi.fn();
    render(<Scatter tags={TAGS} crossing={CROSSING} onChoose={onChoose} />);
    fireEvent.click(screen.getByRole("option", { name: /^crowded:/ }));
    expect(onChoose).toHaveBeenCalledWith("crowded");
  });

  it("names no colour: the stylesheet binds hue by class", () => {
    render(<Scatter tags={TAGS} crossing={CROSSING} onChoose={() => {}} />);
    for (const el of document.querySelectorAll("svg *")) {
      expect(el.getAttribute("fill")).toBeNull();
      expect(el.getAttribute("stroke")).toBeNull();
    }
  });
});

describe("the attention scatter — re-measure pending", () => {
  it("keeps the old point, and names it pending in its label and beside its name, not by outline alone", () => {
    render(
      <Scatter
        tags={[{ ...point("old", 3, 0.5), pending: true }, point("new", 4, 1)]}
        crossing={null}
        onChoose={() => {}}
      />
    );
    const old = screen.getByRole("option", { name: /^old:/ });
    expect(old.getAttribute("aria-label")).toBe(
      "old: 3 papers, growth +50%, re-measure pending"
    );
    expect(old.textContent).toContain("re-measure pending");
    const fresh = screen.getByRole("option", { name: /^new:/ });
    expect(fresh.getAttribute("aria-label")).not.toContain("pending");
    expect(fresh.textContent).not.toContain("pending");
  });
});
