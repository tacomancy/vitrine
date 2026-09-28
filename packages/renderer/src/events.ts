import { useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import type { CoreEvent } from "core";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import { INBOX, replaceRoute } from "./router";
import { useTRPC } from "./trpc";

type VaultChanged = Extract<CoreEvent, { type: "vaultChanged" }>;
type Listener = (event: VaultChanged) => void;

/**
 * The core's event stream, subscribed once for the window's life (ADR 0013
 * decision 11). Every reaction is an invalidation, never a patch of list
 * state: on `vaultChanged` the list is re-read from the index, and on every
 * connect and reconnect every query is — the stream replays nothing, so the
 * reconnect is the catch-up for whatever was missed while it was down. A
 * `vaultSwitched` is the one event that empties the cache rather than
 * invalidating it, and moves the window to the Inbox; `vaultPath` is the
 * open vault's folder, so a switch the stream missed is caught on reconnect.
 * Returns the set a surface registers with through `useVaultChanged` to
 * follow a path it holds; the set is told before the invalidation, so a
 * selection has moved by the time the re-query lands.
 */
export function useCoreEvents(vaultPath: string | null): Set<Listener> {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const listeners = useRef(new Set<Listener>());
  // The folder the window's cache and route belong to (#377).
  const shown = useRef<string | null>(null);
  // A reset, not an invalidation: an invalidated query keeps answering with
  // the old vault's data until its refetch lands, and no list may mix two
  // vaults (spec #363 story 14). The cache is emptied before the route
  // moves, so the Inbox is never drawn from the old vault's rows. Replaced
  // rather than pushed: the switch is not a place to go back to.
  const switchWindow = useCallback(() => {
    void queryClient.resetQueries();
    replaceRoute(INBOX);
  }, [queryClient]);
  useSubscription(
    trpc.events.subscribe.subscriptionOptions(undefined, {
      onStarted: () => void queryClient.invalidateQueries(),
      onData: (event) => {
        if (event.type === "vaultChanged") {
          for (const listen of listeners.current) listen(event);
          // Everything read from the index (spec #177 § Renderer), and the
          // pages, which read their files beside it — an Obsidian edit to a
          // claim is on the page within the settle window (spec #327 story
          // 86); the tag tree and outlines have no consumer yet, but the
          // rule is one.
          void queryClient.invalidateQueries(trpc.questions.list.pathFilter());
          void queryClient.invalidateQueries(trpc.vault.tags.pathFilter());
          void queryClient.invalidateQueries(trpc.vault.kinds.pathFilter());
          void queryClient.invalidateQueries(trpc.vault.outline.pathFilter());
          void queryClient.invalidateQueries(
            trpc.researchQuestions.page.pathFilter()
          );
          void queryClient.invalidateQueries(trpc.hypotheses.page.pathFilter());
          void queryClient.invalidateQueries(
            trpc.experiments.page.pathFilter()
          );
          // A CSV a script rewrote in place is the same line with new rows.
          void queryClient.invalidateQueries(
            trpc.experiments.artifactPreview.pathFilter()
          );
          void queryClient.invalidateQueries(trpc.looseEnds.rows.pathFilter());
        } else if (event.type === "vaultStatus") {
          void queryClient.invalidateQueries(trpc.vault.status.pathFilter());
        } else if (event.type === "pdfFolder") {
          // The core checked the PDF folder (#379): the footer's *papers not
          // arriving* and Settings' rows re-read what it found.
          void queryClient.invalidateQueries(trpc.vault.pdfFault.pathFilter());
          void queryClient.invalidateQueries(trpc.vault.pdfFolder.pathFilter());
        } else if (event.type === "vaultSwitched") {
          // Another vault is open (#377), whichever way it was asked for —
          // Settings, First run, or File ▸ Open Vault…, which the shell
          // sends straight to the core.
          shown.current = event.vault.path;
          switchWindow();
        }
      },
    })
  );

  // The stream replays nothing, so a switch raised while it was down is
  // learned only when the reconnect's re-read of `vault.current` names
  // another folder. That gets the same reset, late; the event's own reset
  // has already recorded the path, so the two never both fire.
  useEffect(() => {
    if (vaultPath === null) return;
    if (shown.current !== null && shown.current !== vaultPath) switchWindow();
    shown.current = vaultPath;
  }, [vaultPath, switchWindow]);

  return listeners.current;
}

export const VaultChangedListeners = createContext<Set<Listener>>(new Set());

/** Hear every `vaultChanged` for as long as the caller is mounted. */
export function useVaultChanged(listener: Listener): void {
  const listeners = useContext(VaultChangedListeners);
  useEffect(() => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, [listeners, listener]);
}
