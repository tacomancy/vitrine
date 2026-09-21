import { useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import type { CoreEvent } from "core";
import { createContext, useContext, useEffect, useRef } from "react";
import { useTRPC } from "./trpc";

type VaultChanged = Extract<CoreEvent, { type: "vaultChanged" }>;
type Listener = (event: VaultChanged) => void;

/**
 * The core's event stream, subscribed once for the window's life (ADR 0013
 * decision 11). Every reaction is an invalidation, never a patch of list
 * state: on `vaultChanged` the list is re-read from the index, and on every
 * connect and reconnect every query is — the stream replays nothing, so the
 * reconnect is the catch-up for whatever was missed while it was down.
 * Returns the set a surface registers with through `useVaultChanged` to
 * follow a path it holds; the set is told before the invalidation, so a
 * selection has moved by the time the re-query lands.
 */
export function useCoreEvents(): Set<Listener> {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const listeners = useRef(new Set<Listener>());
  useSubscription(
    trpc.events.subscribe.subscriptionOptions(undefined, {
      onStarted: () => void queryClient.invalidateQueries(),
      onData: (event) => {
        if (event.type === "vaultChanged") {
          for (const listen of listeners.current) listen(event);
          void queryClient.invalidateQueries(trpc.questions.list.pathFilter());
        } else if (event.type === "vaultStatus") {
          void queryClient.invalidateQueries(trpc.vault.status.pathFilter());
        }
      },
    })
  );
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
