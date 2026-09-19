// Shared by the component suites: the App rendered against a fake router
// client, so the renderer is tested against the router's contract without a
// socket or the core itself.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { render } from "@testing-library/react";
import type { AppRouter } from "core";
import { App } from "./App";
import { TRPCProvider } from "./trpc";

/** A fixed value, or a function of the procedure's input that computes (or throws) one per call. */
export type Answer = unknown;

// A link that answers every procedure from a table. An answer that throws
// reaches the component as the error the core would send.
export function fakeLink(answers: Record<string, Answer>): TRPCLink<AppRouter> {
  return () =>
    ({ op }) =>
      observable((observer) => {
        const answer = answers[op.path];
        try {
          const data =
            typeof answer === "function"
              ? (answer as (input: unknown) => unknown)(op.input)
              : answer;
          observer.next({ result: { type: "data", data } });
          observer.complete();
        } catch (error) {
          observer.error(TRPCClientError.from(error as Error));
        }
      });
}

export function renderApp(answers: Record<string, Answer>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const trpcClient = createTRPCClient<AppRouter>({
    links: [fakeLink(answers)],
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <App />
      </TRPCProvider>
    </QueryClientProvider>
  );
}
