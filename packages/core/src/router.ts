import { initTRPC, TRPCError } from "@trpc/server";
import { listQuestions, type Order } from "./questions.js";
import { VaultError, type VaultService } from "./vault.js";

export type Context = { vault: VaultService };

const t = initTRPC.context<Context>().create({
  // A refused open reaches the client as a plain message plus its kind
  // (notAFolder | unreadable), the typed errors the vault contract promises.
  errorFormatter: ({ shape, error }) => {
    const cause = error.cause;
    const kind = cause instanceof VaultError ? cause.kind : undefined;
    return { ...shape, data: { ...shape.data, kind } };
  },
});

// The one input shape this slice takes; a schema library can replace this
// when a second procedure needs one.
function pathInput(value: unknown): { path: string } {
  if (
    typeof value === "object" &&
    value !== null &&
    "path" in value &&
    typeof value.path === "string"
  ) {
    return { path: value.path };
  }
  throw new Error("expected { path: string }");
}

function orderInput(value: unknown): { order: Order } {
  if (value === undefined || value === null) return { order: "newest" };
  if (
    typeof value === "object" &&
    "order" in value &&
    (value.order === "newest" || value.order === "oldest")
  ) {
    return { order: value.order };
  }
  throw new Error("expected { order: 'newest' | 'oldest' }");
}

/** Turn a VaultError into the BAD_REQUEST the formatter above unpacks. */
async function refusing<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (cause) {
    if (cause instanceof VaultError) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: cause.message,
        cause,
      });
    }
    throw cause;
  }
}

export const router = t.router({
  health: t.procedure.query(() => ({ ok: true as const })),
  vault: t.router({
    current: t.procedure.query(({ ctx }) => ctx.vault.current()),
    open: t.procedure
      .input(pathInput)
      .mutation(({ ctx, input }) => refusing(ctx.vault.open(input.path))),
    pick: t.procedure.mutation(({ ctx }) => refusing(ctx.vault.pick())),
  }),
  questions: t.router({
    list: t.procedure.input(orderInput).query(async ({ ctx, input }) => {
      const vault = await ctx.vault.current();
      if (vault === null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No vault is open.",
        });
      }
      return listQuestions(vault.path, input.order);
    }),
  }),
});

// The contract the renderer imports type-only (ADR 0005).
export type AppRouter = typeof router;
