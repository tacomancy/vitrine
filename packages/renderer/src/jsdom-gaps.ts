/**
 * What jsdom leaves out, supplied for the suite and nowhere else.
 *
 * jsdom implements no layout and therefore no scrolling: `scrollIntoView` is
 * *absent* from its `Element.prototype` rather than a no-op on it, so a
 * call throws. Every keyboard list makes that call when its choice moves
 * (`chosen.ts`), which is most of what the surface suites do.
 *
 * Deliberately here rather than as a `?.` in the hook. A call that lands on
 * nothing is the bug the hook exists to fix, and a guard in the app would
 * hide it in the one environment able to see it at all — the browsers
 * Vitrine ships to have implemented this since IE. A test that wants to know
 * a list followed its choice spies on this (`scrollsInto` in
 * `fake-core.tsx`), because there is no geometry under jsdom to measure.
 */
Element.prototype.scrollIntoView = function scrollIntoView() {
  // Nothing to scroll: jsdom gives every element a zero-sized box.
};
