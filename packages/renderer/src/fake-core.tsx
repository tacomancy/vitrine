import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { AppRouter, CoreEvent } from "core";
import { App } from "./App";
import { TRPCProvider } from "./trpc";

/** A fixed value, or a function that computes (or throws) one per call. */
export type Answer = unknown;

/**
 * The faked `events.subscribe`: what a test pushes arrives as the core's
 * stream would deliver it, and `reconnect` replays what the client link does
 * when the connection drops and comes back.
 */
export type FakeStream = {
  push: (event: CoreEvent) => void;
  reconnect: () => void;
};

type SubscriptionObserver = {
  next: (envelope: {
    result:
      | { type: "started" }
      | { type: "data"; data: CoreEvent }
      | { type: "state"; state: "connecting"; error: null };
  }) => void;
};

// A link that answers every procedure from a table, so the renderer is tested
// against the router's contract without a socket or the core itself. An
// answer that throws reaches the component as the error the core would send.
// A subscription is held open and driven by the FakeStream.
function fakeLink(
  answers: Record<string, Answer>,
  subscribers: Set<SubscriptionObserver>
): TRPCLink<AppRouter> {
  return () =>
    ({ op }) =>
      observable((observer) => {
        if (op.type === "subscription") {
          const subscriber = observer as unknown as SubscriptionObserver;
          subscribers.add(subscriber);
          // Connected on a later tick, as a real SSE connect is: the queries
          // have mounted by then, so the connect's invalidation reaches them.
          const connect = setTimeout(() => {
            if (subscribers.has(subscriber)) {
              subscriber.next({ result: { type: "started" } });
            }
          }, 0);
          return () => {
            clearTimeout(connect);
            subscribers.delete(subscriber);
          };
        }
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
  const subscribers = new Set<SubscriptionObserver>();
  const trpcClient = createTRPCClient<AppRouter>({
    links: [fakeLink(answers, subscribers)],
  });
  const stream: FakeStream = {
    push: (event) => {
      for (const s of subscribers)
        s.next({ result: { type: "data", data: event } });
    },
    reconnect: () => {
      for (const s of subscribers) {
        s.next({ result: { type: "state", state: "connecting", error: null } });
        s.next({ result: { type: "started" } });
      }
    },
  };
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <App />
      </TRPCProvider>
    </QueryClientProvider>
  );
  return { ...rendered, stream };
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
