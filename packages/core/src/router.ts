import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import { listQuestions } from "./list.js";
import type { QuestionService } from "./questions.js";
import { VaultError, type VaultService } from "./vault.js";
import { readOutline } from "./vault-files.js";

export type Context = { vault: VaultService; questions: QuestionService };

const t = initTRPC.context<Context>().create({
  // A refused open or write reaches the client as a plain message plus its
  // kind (VaultErrorKind), the typed errors the vault contract promises.
  errorFormatter: ({ shape, error }) => {
    const cause = error.cause;
    const kind = cause instanceof VaultError ? cause.kind : undefined;
    return { ...shape, data: { ...shape.data, kind } };
  },
});

const pathInput = z.object({ path: z.string() });

const listInput = z
  .object({ order: z.enum(["newest", "oldest"]).default("newest") })
  .default({ order: "newest" });

// Only Unattached exists yet. `strict` is what makes a `from` key — or any
// later context — an input error today, so later contexts extend this
// schema rather than change what callers already rely on.
const captureInput = z.object({
  text: z.string().trim().min(1, "Question text is empty."),
  provenance: z.object({ context: z.literal("other") }).strict(),
});

/** The open vault, or the PRECONDITION_FAILED a procedure that needs one raises. */
async function requireVault(ctx: Context) {
  const vault = await ctx.vault.current();
  if (vault === null) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No vault is open.",
    });
  }
  return vault;
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
    outline: t.procedure.input(pathInput).query(async ({ ctx, input }) => {
      const vault = await requireVault(ctx);
      return refusing(readOutline(vault.path, input.path));
    }),
  }),
  questions: t.router({
    list: t.procedure.input(listInput).query(async ({ ctx, input }) => {
      const vault = await requireVault(ctx);
      return listQuestions(vault.path, input.order);
    }),
    capture: t.procedure
      .input(captureInput)
      .mutation(({ ctx, input }) =>
        refusing(ctx.questions.capture(input.text, input.provenance))
      ),
  }),
});

// The contract the renderer imports type-only (ADR 0005).
export type AppRouter = typeof router;
