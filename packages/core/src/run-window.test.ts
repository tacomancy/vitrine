import { afterEach, describe, expect, it, vi } from "vitest";
import { createRunWindow, effectiveRunWindowMs } from "./run-window.js";

afterEach(() => vi.useRealTimers());

// What a hold does when the world moves under it (#561; spec #556). The rule
// is the callee's: these build the window directly, with no vault service to
// remember anything for it.

const SETTLE = 40;
const WINDOW = effectiveRunWindowMs(0, SETTLE);

function windowOf(
  isOpen: () => boolean = () => true,
  ceilingMs = 100 * WINDOW
) {
  vi.useFakeTimers();
  const runs: string[][] = [];
  const w = createRunWindow({
    settleMs: SETTLE,
    windowMs: 0,
    ceilingMs,
    run: (paths) => runs.push(paths),
    isOpen,
  });
  return { w, runs };
}

describe("a held PDF that is renamed", () => {
  it("is read under its new name, and the old one is not", () => {
    const { w, runs } = windowOf();
    w.hold(["sources/pdf/a.pdf"]);
    w.move([{ from: "sources/pdf/a.pdf", to: "sources/pdf/b.pdf" }]);
    vi.advanceTimersByTime(WINDOW);
    expect(runs).toEqual([["sources/pdf/b.pdf"]]);
  });

  it("starts the window again", () => {
    const { w, runs } = windowOf();
    w.hold(["sources/pdf/a.pdf"]);
    vi.advanceTimersByTime(WINDOW - 1);
    w.move([{ from: "sources/pdf/a.pdf", to: "sources/pdf/b.pdf" }]);
    vi.advanceTimersByTime(WINDOW - 1);
    expect(runs).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(runs).toEqual([["sources/pdf/b.pdf"]]);
  });

  it("is nothing to hold when nothing was held under the old name", () => {
    const { w, runs } = windowOf();
    w.move([{ from: "sources/pdf/a.pdf", to: "sources/pdf/b.pdf" }]);
    vi.advanceTimersByTime(10 * WINDOW);
    expect(runs).toEqual([]);
  });
});

describe("a held PDF that is deleted", () => {
  it("is not read, and the others still are", () => {
    const { w, runs } = windowOf();
    w.hold(["sources/pdf/a.pdf", "sources/pdf/b.pdf"]);
    w.drop(["sources/pdf/a.pdf"]);
    vi.advanceTimersByTime(WINDOW);
    expect(runs).toEqual([["sources/pdf/b.pdf"]]);
  });

  it("leaves no run at all when it was the only one", () => {
    const { w, runs } = windowOf();
    w.hold(["sources/pdf/a.pdf"]);
    w.drop(["sources/pdf/a.pdf"]);
    vi.advanceTimersByTime(10 * WINDOW);
    expect(runs).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("a hold that fires after its vault stopped being the open one", () => {
  // The guard is in the firing, so it holds with no teardown having called
  // `close()` at all: a path that forgot its cleanup is still safe.
  it("does nothing", () => {
    let open = true;
    const { w, runs } = windowOf(() => open);
    w.hold(["sources/pdf/a.pdf"]);
    open = false;
    vi.advanceTimersByTime(10 * WINDOW);
    expect(runs).toEqual([]);
  });

  it("does not run for the ceiling either", () => {
    let open = true;
    const { w, runs } = windowOf(() => open, 3 * WINDOW);
    // Held again before each window ends, so only the ceiling can fire.
    w.hold(["sources/pdf/a.pdf"]);
    vi.advanceTimersByTime(WINDOW - 1);
    w.hold(["sources/pdf/a.pdf"]);
    vi.advanceTimersByTime(WINDOW - 1);
    w.hold(["sources/pdf/a.pdf"]);
    open = false;
    vi.advanceTimersByTime(10 * WINDOW);
    expect(runs).toEqual([]);
  });
});

describe("the timers", () => {
  it("never keep the process alive", () => {
    vi.useFakeTimers();
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const real = globalThis.setTimeout;
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      ...args: Parameters<typeof setTimeout>
    ) => {
      const timer = real(...args);
      timers.push(timer);
      return timer;
    }) as typeof setTimeout);
    const w = createRunWindow({
      settleMs: SETTLE,
      windowMs: 0,
      ceilingMs: 0,
      run: () => {},
      isOpen: () => true,
    });
    w.hold(["sources/pdf/a.pdf"]);
    w.move([{ from: "sources/pdf/a.pdf", to: "sources/pdf/b.pdf" }]);
    expect(timers.length).toBeGreaterThanOrEqual(3);
    for (const timer of timers) expect(timer.hasRef()).toBe(false);
    spy.mockRestore();
  });
});
