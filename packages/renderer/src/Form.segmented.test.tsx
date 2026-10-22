import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { SegmentedControl } from "./Form";

afterEach(cleanup);

// #784 (spec #782): one control for every one-of-N choice, on real radios so
// the keyboard and the screen reader get what the platform gives a radio group.

function Harness() {
  const [sort, setSort] = useState<"rank" | "newest" | "oldest">("rank");
  return (
    <>
      <button type="button">before</button>
      <SegmentedControl
        label="Sort"
        value={sort}
        onChange={setSort}
        options={[
          { value: "rank", label: "Rank" },
          { value: "newest", label: "Newest" },
          { value: "oldest", label: "Oldest" },
        ]}
      />
      <button type="button">after</button>
    </>
  );
}

const radio = (name: string) =>
  screen.getByRole<HTMLInputElement>("radio", { name });

describe("SegmentedControl", () => {
  it("is announced as a group with its name, one radio per option", () => {
    render(<Harness />);
    const group = screen.getByRole("radiogroup", { name: "Sort" });
    expect(group).toBeDefined();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(radio("Rank").checked).toBe(true);
    expect(radio("Newest").checked).toBe(false);
  });

  it("selects on click", () => {
    render(<Harness />);
    fireEvent.click(radio("Newest"));
    expect(radio("Newest").checked).toBe(true);
    expect(radio("Rank").checked).toBe(false);
  });

  it("moves and selects with the arrow keys, wrapping at the ends", () => {
    render(<Harness />);
    radio("Rank").focus();
    fireEvent.keyDown(radio("Rank"), { key: "ArrowRight" });
    expect(radio("Newest").checked).toBe(true);
    expect(document.activeElement).toBe(radio("Newest"));
    fireEvent.keyDown(radio("Newest"), { key: "ArrowDown" });
    expect(radio("Oldest").checked).toBe(true);
    fireEvent.keyDown(radio("Oldest"), { key: "ArrowRight" });
    expect(radio("Rank").checked).toBe(true);
    fireEvent.keyDown(radio("Rank"), { key: "ArrowLeft" });
    expect(radio("Oldest").checked).toBe(true);
    fireEvent.keyDown(radio("Oldest"), { key: "ArrowUp" });
    expect(radio("Newest").checked).toBe(true);
  });

  it("is one Tab stop: only the chosen radio is tabbable, and Tab is left to the browser", () => {
    render(<Harness />);
    expect(radio("Rank").tabIndex).toBe(0);
    expect(radio("Newest").tabIndex).toBe(-1);
    expect(radio("Oldest").tabIndex).toBe(-1);
    const tab = fireEvent.keyDown(radio("Rank"), { key: "Tab" });
    // Not prevented, and nothing moved.
    expect(tab).toBe(true);
    expect(radio("Rank").checked).toBe(true);
  });

  it("leaves Alt+arrow to the browser", () => {
    render(<Harness />);
    const kept = fireEvent.keyDown(radio("Rank"), {
      key: "ArrowLeft",
      altKey: true,
    });
    expect(kept).toBe(true);
    expect(radio("Rank").checked).toBe(true);
  });
});
