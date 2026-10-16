import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCapture } from "./capture";
import { renderApp } from "./fake-core";

afterEach(cleanup);

// The hook alone: the chord's line freezes its selection at the opening, so
// the app cannot make the second write after the first on one hook instance —
// but the hook's `error` is the last attempt's whichever caller drives it.
function Probe() {
  const capture = useCapture();
  const selection = { page: 1, rects: [[0, 0, 1, 1]] };
  const reading = { context: "reading", source: "s.pdf", page: 1 } as const;
  return (
    <>
      <button
        onClick={() => capture.write("Why?", reading, () => {}, selection)}
      >
        from selection
      </button>
      <button onClick={() => capture.write("Why?", reading, () => {})}>
        plain
      </button>
      <output>{capture.error?.message ?? "none"}</output>
    </>
  );
}

describe("useCapture", () => {
  it("says the last attempt's refusal: a refused selection, then a refused plain capture", async () => {
    renderApp(
      {
        "sources.question": () => {
          throw new Error("There is no text under that selection.");
        },
        "questions.capture": () => {
          throw new Error("Couldn't write the Question.");
        },
      },
      <Probe />
    );
    fireEvent.click(screen.getByText("from selection"));
    await vi.waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "There is no text under that selection."
      )
    );
    fireEvent.click(screen.getByText("plain"));
    await vi.waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "Couldn't write the Question."
      )
    );
  });
});
