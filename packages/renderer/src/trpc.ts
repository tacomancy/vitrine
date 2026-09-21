import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
} from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import type { AppRouter } from "core";
import { EventSource } from "eventsource";

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

/**
 * The typed client for the core the shell told us about. Queries and
 * mutations batch over HTTP; the one subscription is SSE. The browser's
 * `EventSource` cannot send a header and the token never travels in a URL,
 * so the stream uses the `eventsource` ponyfill with the bearer header set
 * on its `fetch` (ADR 0013 decision 11).
 */
export function createClient({ port, token }: Window["vitrine"]) {
  const url = `http://127.0.0.1:${port}/trpc`;
  const authorization = `Bearer ${token}`;
  return createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (op) => op.type === "subscription",
        true: httpSubscriptionLink({
          url,
          EventSource,
          eventSourceOptions: {
            fetch: (input, init) =>
              fetch(input, {
                ...init,
                headers: { ...init.headers, authorization },
              }),
          },
        }),
        false: httpBatchLink({ url, headers: { authorization } }),
      }),
    ],
  });
}
