import { useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useTRPC } from "./trpc";

/**
 * The core's event stream, subscribed once for the window's life (ADR 0013
 * decision 11). Every reaction is an invalidation, never a patch of list
 * state: on `vaultChanged` the list is re-read from the index, and on every
 * connect and reconnect every query is — the stream replays nothing, so the
 * reconnect is the catch-up for whatever was missed while it was down.
 */
export function useCoreEvents() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  useSubscription(
    trpc.events.subscribe.subscriptionOptions(undefined, {
      onStarted: () => void queryClient.invalidateQueries(),
      onData: (event) => {
        if (event.type === "vaultChanged") {
          void queryClient.invalidateQueries(trpc.questions.list.pathFilter());
        }
      },
    })
  );
}
