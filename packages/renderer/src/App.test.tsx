import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { render, screen } from "@testing-library/react";
import type { AppRouter } from "core";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { TRPCProvider } from "./trpc";

// A link that answers every procedure from a table, so the renderer is tested
// against the router's contract without a socket or the core itself.
function fakeLink(answers: Record<string, unknown>): TRPCLink<AppRouter> {
  return () =>
    ({ op }) =>
      observable((observer) => {
        observer.next({ result: { type: "data", data: answers[op.path] } });
        observer.complete();
      });
}

function renderApp(answers: Record<string, unknown>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const trpcClient = createTRPCClient<AppRouter>({
    links: [fakeLink(answers)],
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <App port={4242} />
      </TRPCProvider>
    </QueryClientProvider>
  );
}

describe("App", () => {
  it("draws the title bar reading Vitrine", () => {
    renderApp({ health: { ok: true } });
    expect(screen.getByRole("banner").textContent).toContain("Vitrine");
  });

  it("shows the core answering once health returns", async () => {
    renderApp({ health: { ok: true } });
    expect(
      await screen.findByText("core answering on 127.0.0.1:4242")
    ).toBeDefined();
  });
});
