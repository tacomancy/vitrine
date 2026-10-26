/**
 * A stand-in for the browser's width signal, for the suite and nowhere else.
 *
 * jsdom lays nothing out, so it has no `ResizeObserver` and cannot evaluate a
 * container query. The Queue reads its own width through a `ResizeObserver`
 * (`queue-width.ts`); this class is what answers it under test, with whatever
 * width `setQueueWidth` last set, so a test can hold the window at one size
 * and move the Queue between two. `jsdom-gaps.ts` installs it.
 */
const WIDE_ENOUGH = 1200;

let width = WIDE_ENOUGH;
const watching = new Set<StubResizeObserver>();

class StubResizeObserver {
  private targets = new Set<Element>();

  constructor(private callback: ResizeObserverCallback) {}

  observe(target: Element) {
    this.targets.add(target);
    watching.add(this);
    this.report();
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
    watching.delete(this);
  }

  report() {
    const entries = [...this.targets].map(
      (target) =>
        ({ target, contentRect: { width } }) as unknown as ResizeObserverEntry
    );
    if (entries.length > 0) this.callback(entries, this);
  }
}

/** The width every observed element reports from now on; tells those already watching. */
export function setQueueWidth(px: number) {
  width = px;
  for (const observer of watching) observer.report();
}

/** Back to a width that is wide, so one test's narrow Queue is not the next one's. */
export function resetQueueWidth() {
  width = WIDE_ENOUGH;
  watching.clear();
}

export function installStubResizeObserver() {
  globalThis.ResizeObserver = StubResizeObserver;
}
