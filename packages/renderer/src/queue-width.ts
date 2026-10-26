import { useLayoutEffect, useRef, useState } from "react";

/**
 * The Queue's own width, from which it is wide or narrow (ADR 0054 decision 2).
 *
 * 960px puts the abstract at about 60 characters of line at a 1280px window
 * with the sidebar (238px) open and the rail present: the detail takes 3 of 5
 * parts of the Queue (ADR 0052), and its card keeps its padding and margin.
 */
export const WIDE_FROM = 960;

export type QueueLayout = "wide" | "narrow";

/**
 * One signal for the stylesheet and the component: the layout is a
 * `data-layout` attribute the stylesheet selects on and the component can read,
 * so the threshold is written once and cannot drift between a container query
 * and a script. It measures the element it is given, not the window, so the
 * sidebar and the rail move the switch as the window does.
 *
 * Wide until a width has been read: the layout before the first measure is the
 * one a researcher on a laptop sees anyway, and it costs no flash there.
 */
export function useQueueLayout() {
  const ref = useRef<HTMLElement>(null);
  const [layout, setLayout] = useState<QueueLayout>("wide");

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[entries.length - 1]!.contentRect.width;
      setLayout(width >= WIDE_FROM ? "wide" : "narrow");
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, layout };
}
