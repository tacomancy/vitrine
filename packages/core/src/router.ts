import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Events } from "./events.js";
import { listQuestions } from "./list.js";
import type { QuestionService } from "./questions.js";
import { VaultError } from "./errors.js";
import type { VaultService } from "./vault.js";
import {
  EDITED_SECTIONS,
  readResearchQuestionPage,
  saveSection,
  tickThread,
} from "./research-question.js";
import { outlineFromIndex } from "./vault-outline.js";
import { tagTree } from "./vault-tags.js";

export type Context = {
  vault: VaultService;
  questions: QuestionService;
  events: Events;
};

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

// Unattached, or pursuing a Research Question from its page (#221). `strict`
// is what makes a stray key — or a context no surface has yet — an input
// error, so later contexts extend this union rather than loosen it.
const captureInput = z.object({
  text: z.string().trim().min(1, "Question text is empty."),
  provenance: z.discriminatedUnion("context", [
    z.object({ context: z.literal("other") }).strict(),
    z
      .object({
        context: z.literal("pursuing"),
        /** The page's vault-relative path. */
        researchQuestion: z.string().min(1),
      })
      .strict(),
  ]),
});

const noVault = () =>
  new TRPCError({ code: "PRECONDITION_FAILED", message: "No vault is open." });

/** The open vault and its index, or the PRECONDITION_FAILED a procedure that needs them raises. */
async function requireVault(ctx: Context) {
  const opened = await ctx.vault.opened();
  if (opened === null) throw noVault();
  return opened;
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
      const { vault, index } = await requireVault(ctx);
      return refusing(outlineFromIndex(index, vault.path, input.path));
    }),
    status: t.procedure.query(async ({ ctx }) => {
      const status = await ctx.vault.status();
      if (status === null) throw noVault();
      return status;
    }),
    // The footer's *retry* on `not watching`: reopen the watcher and sweep.
    rewatch: t.procedure.mutation(async ({ ctx }) => {
      await requireVault(ctx);
      await ctx.vault.rewatch();
    }),
    tags: t.procedure.query(async ({ ctx }) => {
      const { index } = await requireVault(ctx);
      return tagTree(index);
    }),
  }),
  events: t.router({
    // One SSE stream per renderer, behind the same bearer guard as every
    // other /trpc request; the renderer reacts by invalidating queries.
    subscribe: t.procedure.subscription(({ ctx, signal }) =>
      ctx.events.subscribe(signal)
    ),
  }),
  researchQuestions: t.router({
    // The page: the file's body from disk, each link's resolution from the
    // index (`research-question.ts`). Read-only until the section tickets.
    page: t.procedure.input(pathInput).query(async ({ ctx, input }) => {
      const { vault, index } = await requireVault(ctx);
      return refusing(readResearchQuestionPage(index, vault.path, input.path));
    }),
    // The page's writes answer with the write's own result — a refusal is
    // data the page shows as a line, never a silent no-op. Both replace an
    // Edited section whole and record no Revision (ADR 0020 decision 4).
    // A plain text field's save: the section replaced with what was typed,
    // `basedOn` the hash the page read. Only the Edited sections without a
    // Position — Working answer's save records its Revision (#213).
    saveSection: t.procedure
      .input(
        pathInput.extend({
          section: z.enum(EDITED_SECTIONS),
          body: z.string(),
          basedOn: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { vault, index } = await requireVault(ctx);
        return refusing(saveSection(index, vault.path, input.path, input));
      }),
    // A thread ticked in place, named by its text.
    tickThread: t.procedure
      .input(pathInput.extend({ text: z.string(), done: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const { vault, index } = await requireVault(ctx);
        return refusing(tickThread(index, vault.path, input.path, input));
      }),
  }),
  questions: t.router({
    list: t.procedure.input(listInput).query(async ({ ctx, input }) => {
      const { vault, index } = await requireVault(ctx);
      return listQuestions(index, vault.path, input.order);
    }),
    capture: t.procedure
      .input(captureInput)
      .mutation(({ ctx, input }) =>
        refusing(ctx.questions.capture(input.text, input.provenance))
      ),
    // Promote to Research Question (#210): the page written whole, then
    // the Question marked; a refusal is the typed error the formatter
    // unpacks, shown on the row.
    promote: t.procedure
      .input(pathInput)
      .mutation(({ ctx, input }) =>
        refusing(ctx.questions.promote(input.path))
      ),
  }),
});

// The contract the renderer imports type-only (ADR 0005).
export type AppRouter = typeof router;
