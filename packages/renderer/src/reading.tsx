import { createContext, useContext, useEffect } from "react";
import type { PageSelection } from "./pdf-document";

/**
 * What the Reader is showing, for the chord that is the window's (#427): the
 * Source, the page in view, and the selection if there is one. The Reader
 * publishes it and the window reads it, so ⌘' resolves its Provenance the
 * way it does on every other surface — from what is open — without the
 * chord knowing what a Reader is.
 */
export type Reading = {
  source: string;
  /** 1-based; the selection's page when there is a selection. */
  page: number;
  selection: PageSelection | null;
  /** The selection has been written into the paper: let go of it. */
  spend: () => void;
};

export const PublishReading = createContext<(reading: Reading | null) => void>(
  () => undefined
);

export function usePublishReading(reading: Reading) {
  const publish = useContext(PublishReading);
  const { source, page, selection, spend } = reading;
  useEffect(() => {
    publish({ source, page, selection, spend });
  }, [publish, source, page, selection, spend]);
  // Only on leaving: a republish on every move would blink the chord's
  // Provenance through `other` between them.
  useEffect(() => () => publish(null), [publish]);
}
