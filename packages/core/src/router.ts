import { initTRPC } from "@trpc/server";

const t = initTRPC.create();

export const router = t.router({
  health: t.procedure.query(() => ({ ok: true as const })),
});

// The contract the renderer imports type-only (ADR 0005).
export type AppRouter = typeof router;
