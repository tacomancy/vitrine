import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { AcceptRate, AcceptWeek, AppRouter, CoreEvent } from "core";
import { vi } from "vitest";
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

// A link that answers every procedure from a table (or, for a promise, once
// it settles), so the renderer is tested
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
          // An answer that is a promise is one the test holds open — a
          // copy still on its way — and lands when the test resolves it.
          if (data instanceof Promise) {
            data.then(
              (value) => {
                observer.next({ result: { type: "data", data: value } });
                observer.complete();
              },
              (error: unknown) =>
                observer.error(TRPCClientError.from(error as Error))
            );
            return;
          }
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

const WEEK = 7 * 86_400_000;

/**
 * A Scout's twelve weeks ending 2026-07-15, oldest first, as the core hands
 * them over; a week not named is a gap with nothing in it. July, so a week's
 * label does not depend on how a locale abbreviates September.
 */
export const weeksOf = (
  filled: Record<number, { triaged: number; rate: number | null }> = {}
): AcceptWeek[] =>
  Array.from({ length: 12 }, (_, i) => ({
    start: new Date(
      Date.parse("2026-07-15T12:00:00Z") - (12 - i) * WEEK
    ).toISOString(),
    triaged: 0,
    rate: null,
    ...filled[i],
  }));

/** An accept rate that can be said, over these weeks, with the core's floor of five. */
export const rateOver = (
  accepted: number,
  triaged: number,
  weeks: AcceptWeek[] = weeksOf()
): AcceptRate => ({
  kind: "rate",
  accepted,
  triaged,
  rate: accepted / triaged,
  weeks,
  weekFloor: 5,
});

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

/** ⌘K, from anywhere in the window. */
export function pressGlobalChord() {
  fireEvent.keyDown(window, { key: "k", metaKey: true });
}

/**
 * Every row a keyboard list has asked the browser to bring into view, in the
 * order it asked (#320). jsdom lays nothing out, so the call and the `block`
 * it carries are the whole of what a test can see — `jsdom-gaps.ts` is what
 * supplies the method to spy on. Restored by `vi.restoreAllMocks()`.
 */
export function scrollsInto(): { row: Element; block: string | undefined }[] {
  const asked: { row: Element; block: string | undefined }[] = [];
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (
    this: Element,
    options?: boolean | ScrollIntoViewOptions
  ) {
    asked.push({
      row: this,
      block: typeof options === "object" ? options.block : undefined,
    });
  });
  return asked;
}
