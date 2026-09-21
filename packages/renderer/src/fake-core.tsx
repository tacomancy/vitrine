import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { AppRouter } from "core";
import { App } from "./App";
import { TRPCProvider } from "./trpc";

/** A fixed value, or a function that computes (or throws) one per call. */
export type Answer = unknown;

// A link that answers every procedure from a table, so the renderer is tested
// against the router's contract without a socket or the core itself. An
// answer that throws reaches the component as the error the core would send.
function fakeLink(answers: Record<string, Answer>): TRPCLink<AppRouter> {
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

// Fixtures the surface suites share: one vault, a Question as the list
// returns it, the empty listing, and the two gestures every test makes.

export const vault = {
  name: "consolidation-vault",
  path: "/v/consolidation-vault",
};

export const empty = { questions: [], partial: [], unreadable: [], shape: [] };

export const question = (
  text: string,
  captured: string,
  rest: Record<string, unknown> = {}
) => ({
  id: text.slice(0, 10),
  path: `${vault.path}/questions/${text}.md`,
  question: text,
  status: "open",
  captured,
  context: "other",
  ...rest,
});

/** The Inbox's rows, once the list has rendered. */
export async function rows() {
  const list = await screen.findByRole("listbox", { name: "Questions" });
  return within(list).findAllByRole("option");
}

/** ⌘', from anywhere in the window. */
export function pressCaptureChord() {
  fireEvent.keyDown(window, { key: "'", metaKey: true });
}
