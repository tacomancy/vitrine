import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Events } from "./events.js";
import { destinations } from "./destinations.js";
import { dismiss, undismiss } from "./dismissals.js";
import {
  addCriterion,
  deleteCriterion,
  editCriterion,
  FIELDS,
  closeLoop,
  overrideState,
  PAGE as HYPOTHESIS_PAGE,
  readHypothesisPage,
  saveHypothesisPosition,
  setCriterionField,
  type EditedField,
} from "./hypothesis.js";
import {
  createExperiment,
  EDITED_SECTIONS as EXPERIMENT_SECTIONS,
  PAGE as EXPERIMENT_PAGE,
  POSITIONS as EXPERIMENT_POSITIONS,
  readExperimentPage,
  saveExperimentPosition,
  saveExperimentSection,
  type ExperimentPosition,
  setExperimentStatus,
  STATUSES as EXPERIMENT_STATUSES,
} from "./experiment.js";
import { explainRevision } from "./page-write.js";
import { listQuestions } from "./list.js";
import { looseEnds } from "./loose-ends.js";
import { wikilinkTo } from "./link-text.js";
import { readPdfFolder } from "./pdf-folder.js";
import { candidates } from "./picker.js";
import { createSourceStub } from "./sources.js";
import type { QuestionService } from "./questions.js";
import { localIso } from "./time.js";
import { VaultError } from "./errors.js";
import type { VaultService } from "./vault.js";
import {
  attachSource,
  detachSource,
  EDITED_SECTIONS,
  moveSource,
  PAGE as RESEARCH_QUESTION_PAGE,
  readResearchQuestionPage,
  reopenResearchQuestion,
  resolveResearchQuestion,
  saveSection,
  saveWorkingAnswer,
  SIDES,
  tickThread,
  type PageContext,
} from "./research-question.js";
import { kindsHeld } from "./vault-kinds.js";
import { outlineFromIndex } from "./vault-outline.js";
import { tagTree } from "./vault-tags.js";

export type Context = {
  vault: VaultService;
  questions: QuestionService;
  events: Events;
  /** The clock a Revision is stamped by, and ADR 0006 decision 5's window; both pinned by tests. */
  now: () => Date;
  coalesceMs: number;
  /** How many open days a promoted Research Question may sit unsourced (#243); tests shorten it. */
  stalledOpenDays: number;
  /** The id source for an object the router makes itself (an Experiment); pinned by tests. */
  newId: () => string;
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

const revealInput = z.object({ folder: z.enum(["vault", "pdfs"]) });

const listInput = z
  .object({ order: z.enum(["newest", "oldest"]).default("newest") })
  .default({ order: "newest" });

// Unattached, pursuing a Research Question or a Hypothesis from its page
// (#221, #339), or resolving one — the follow-up its result raised. `strict`
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
        page: z.string().min(1),
      })
      .strict(),
    z
      .object({
        context: z.literal("resolving"),
        /** The Hypothesis's vault-relative path. */
        hypothesis: z.string().min(1),
      })
      .strict(),
  ]),
});

// `kinds` absent is "anything the vault holds"; an empty array is the
// caller narrowing to nothing, which is not the same thing.
const candidatesInput = z.object({
  query: z.string(),
  kinds: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
});

const linkInput = z.object({ path: z.string(), target: z.string() });

// The attach form's *new stub*: four fields as typed, the title the only
// one the record cannot do without — a stub with no title is a citekey and
// nothing else. The rest default to empty, which is how an absent key is
// said here rather than a missing one.
const stubInput = z.object({
  title: z.string().trim().min(1, "The title is empty."),
  authors: z.string().trim().default(""),
  year: z.string().trim().default(""),
  url: z.string().trim().default(""),
});

/** A criterion's Relationship: one of three, chosen, never defaulted (ADR 0031 decision 4). */
const relationshipInput = z.enum(["confirming", "falsifying", "diagnostic"]);

/** *Answer in place*: the one line the user typed, never empty. */
const answerInput = z.object({
  path: z.string(),
  line: z.string().trim().min(1, "The answer is empty."),
});

/**
 * Promote to Hypothesis: the claim typed on the row. Not refused here when
 * empty — the core refuses it, so the rule holds for every caller, not only
 * the Inbox, whose line never sends one.
 */
const promoteToHypothesisInput = z.object({
  path: z.string(),
  claim: z.string(),
});

const noVault = () =>
  new TRPCError({ code: "PRECONDITION_FAILED", message: "No vault is open." });

/** The open vault and its index, or the PRECONDITION_FAILED a procedure that needs them raises. */
async function requireVault(ctx: Context) {
  const opened = await ctx.vault.opened();
  if (opened === null) throw noVault();
  return opened;
}

/** What a page write needs of the open vault (`research-question.ts`). */
async function requirePage(ctx: Context): Promise<PageContext> {
  const { vault, index, pending } = await requireVault(ctx);
  return { vaultPath: vault.path, index, pending };
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
    // Settings' *Reveal in Finder* (#376, #378). Takes a folder's name, never
    // a path: what can be shown is decided here, so the window cannot ask
    // Finder about anything else.
    reveal: t.procedure.input(revealInput).mutation(async ({ ctx, input }) => {
      await requireVault(ctx);
      await ctx.vault.reveal(input.folder);
    }),
    // Settings' *Where the PDFs are* (#378). A read and nothing else: there
    // is no procedure that makes, re-points or removes the link, or copies a
    // PDF in or out (ADR 0025 decision 6) — the absence is the promise.
    pdfFolder: t.procedure.query(async ({ ctx }) => {
      const { vault } = await requireVault(ctx);
      return readPdfFolder(vault.path);
    }),
    tags: t.procedure.query(async ({ ctx }) => {
      const { index } = await requireVault(ctx);
      return tagTree(index);
    }),
    kinds: t.procedure.query(async ({ ctx }) => {
      const { index } = await requireVault(ctx);
      return kindsHeld(index);
    }),
  }),
  events: t.router({
    // One SSE stream per renderer, behind the same bearer guard as every
    // other /trpc request; the renderer reacts by invalidating queries.
    subscribe: t.procedure.subscription(({ ctx, signal }) =>
      ctx.events.subscribe(signal)
    ),
  }),
  // The one picker over the index's `files` table (#211): the caller
  // names the Kinds to narrow to, and the rows come back capped with the
  // count, so a list that was cut can say so.
  picker: t.router({
    candidates: t.procedure
      .input(candidatesInput)
      .query(async ({ ctx, input }) => {
        const { index } = await requireVault(ctx);
        return candidates(index, {
          query: input.query,
          ...(input.kinds === undefined ? {} : { kinds: input.kinds }),
          ...(input.exclude === undefined ? {} : { exclude: input.exclude }),
        });
      }),
    // The text a picked file is linked by, for the one caller that writes
    // the link into prose rather than into a field of its own: `[[` inside
    // a why line (#216). Link and attach compose theirs in the core at
    // write time with this same rule; the why line has to put the text in
    // the sentence the user is typing, so it asks for it here instead of
    // writing the bare name and hoping it reaches the file that was picked.
    linkText: t.procedure
      .input(z.object({ from: z.string().min(1), to: z.string().min(1) }))
      // `wikilinkTo` throws where every other procedure's work rejects, so
      // the whole body sits inside the promise `refusing` unwraps; beside
      // it, a target the Index has never seen would escape as a 500 rather
      // than the refusal it is.
      .query(({ ctx, input }) =>
        refusing(
          (async () => {
            const { index } = await requireVault(ctx);
            return { text: wikilinkTo(index, input.from, input.to) };
          })()
        )
      ),
  }),
  // Where the Global command can go (#301, ADR 0027): the objects with an
  // Address, matched on their Display names and ordered by how well they
  // answer. The Surfaces and Dashboards are the renderer's own fixed set,
  // merged into these rows there — the core does not know what a screen is.
  globalCommand: t.router({
    destinations: t.procedure
      .input(z.object({ query: z.string() }))
      .query(async ({ ctx, input }) => {
        const { index } = await requireVault(ctx);
        return destinations(index, { query: input.query });
      }),
  }),
  // A stub made by hand (#220; ADR 0020 decision 7): the only path that
  // creates a paper until Scouts land, and the citekey rule that beat reuses.
  sources: t.router({
    createStub: t.procedure
      .input(stubInput)
      .mutation(async ({ ctx, input }) => {
        const { vault, index } = await requireVault(ctx);
        return refusing(createSourceStub(vault.path, index, input));
      }),
  }),
  hypotheses: t.router({
    // The page (#330): the file's body from disk, the Derived state computed
    // from its criteria, each Evidence link's resolution from the index.
    page: t.procedure.input(pathInput).query(async ({ ctx, input }) => {
      const { vault, index } = await requireVault(ctx);
      return refusing(readHypothesisPage(index, vault.path, input.path));
    }),
    // The claim or the design notes, saved as the Working answer is (#333):
    // the section replaced and its Revision recorded in one write, against
    // the hash and the section's text the page read.
    savePosition: t.procedure
      .input(
        pathInput.extend({
          field: z.enum(Object.keys(FIELDS) as [EditedField, ...EditedField[]]),
          text: z.string(),
          basedOn: z.string(),
          was: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) =>
        refusing(
          saveHypothesisPosition(await requirePage(ctx), input.path, {
            ...input,
            at: ctx.now(),
            coalesceMs: ctx.coalesceMs,
          })
        )
      ),
    // Criteria written from the page (#334): each one write carrying its
    // criterion Revision, and a `· state` entry when the Derived state moves.
    // A Relationship is required when a criterion is written — no default
    // (TEST-1) — so the enum has none either.
    addCriterion: t.procedure
      .input(
        pathInput.extend({
          text: z.string(),
          relationship: relationshipInput,
          basedOn: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) =>
        refusing(
          addCriterion(await requirePage(ctx), input.path, {
            ...input,
            at: ctx.now(),
            coalesceMs: ctx.coalesceMs,
          })
        )
      ),
    setCriterionField: t.procedure
      .input(
        pathInput.extend({ id: z.string().min(1), basedOn: z.string() }).and(
          z.discriminatedUnion("field", [
            z.object({
              field: z.literal("outcome"),
              value: z.enum(["met", "not met", "inconclusive"]),
            }),
            z.object({
              field: z.literal("relationship"),
              value: relationshipInput,
            }),
          ])
        )
      )
      .mutation(async ({ ctx, input }) =>
        refusing(
          setCriterionField(await requirePage(ctx), input.path, {
            ...input,
            at: ctx.now(),
            coalesceMs: ctx.coalesceMs,
          })
        )
      ),
    editCriterion: t.procedure
      .input(
        pathInput.extend({
          id: z.string().min(1),
          text: z.string(),
          basedOn: z.string(),
          was: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) =>
        refusing(
          editCriterion(await requirePage(ctx), input.path, {
            ...input,
            at: ctx.now(),
            coalesceMs: ctx.coalesceMs,
          })
        )
      ),
    deleteCriterion: t.procedure
      .input(pathInput.extend({ id: z.string().min(1), basedOn: z.string() }))
      .mutation(async ({ ctx, input }) =>
        refusing(
          deleteCriterion(await requirePage(ctx), input.path, {
            ...input,
            at: ctx.now(),
            coalesceMs: ctx.coalesceMs,
          })
        )
      ),
    // The Override (#337): an entry with a required why, refused unless the
    // derived state is inconclusive with an Outcome recorded and none is
    // live. The why's emptiness is the core's to refuse, in its words, so
    // the input takes any string.
    override: t.procedure
      .input(pathInput.extend({ why: z.string(), basedOn: z.string() }))
      .mutation(async ({ ctx, input }) =>
        refusing(
          overrideState(await requirePage(ctx), input.path, {
            ...input,
            at: ctx.now(),
          })
        )
      ),
    // Close the loop (#338): the result written one hop up, to the Question
    // or Research Question the page was promoted from, and nothing written
    // to the Hypothesis. Refused, with the reason, when the state is not
    // closable or there is no one parent to write to.
    closeLoop: t.procedure
      .input(pathInput.extend({ basedOn: z.string() }))
      .mutation(async ({ ctx, input }) =>
        refusing(
          closeLoop(await requirePage(ctx), input.path, {
            basedOn: input.basedOn,
            at: ctx.now(),
          })
        )
      ),
    // A why onto any entry, as on a Research Question (#216).
    explainRevision: t.procedure
      .input(
        pathInput.extend({
          at: z.string().min(1),
          /** The Revision's field: the timestamp names an entry only within its field. */
          field: z.string().min(1),
          why: z.string().trim().min(1, "The why is empty."),
          basedOn: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) =>
        refusing(
          explainRevision(
            await requirePage(ctx),
            input.path,
            HYPOTHESIS_PAGE,
            input
          )
        )
      ),
  }),
  // The Experiment (#364; spec #362): made by name on its surface, a page
  // of Edited sections and Positions, and a status the user sets by hand.
  experiments: t.router({
    // Refused with its reason when the name is taken or empty, never
    // suffixed; the name is the Experiment's folder.
    create: t.procedure
      .input(z.object({ name: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const { vault, index } = await requireVault(ctx);
        return refusing(
          createExperiment(vault.path, index, input.name, {
            created: localIso(ctx.now()),
            newId: ctx.newId,
          })
        );
      }),
    page: t.procedure.input(pathInput).query(async ({ ctx, input }) => {
      const { vault, index } = await requireVault(ctx);
      return refusing(readExperimentPage(index, vault.path, input.path));
    }),
    // Purpose and *where it ran*: replaced whole, no Revision, and refused
    // when the section changed underneath (the Research Question's guard).
    saveSection: t.procedure
      .input(
        pathInput.extend({
          section: z.enum(EXPERIMENT_SECTIONS),
          body: z.string(),
          basedOn: z.string(),
          was: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) =>
        refusing(
          saveExperimentSection(await requirePage(ctx), input.path, input)
        )
      ),
    // Design or observations (#365): the section replaced and its Revision
    // recorded in one write, as a Hypothesis's claim is saved.
    savePosition: t.procedure
      .input(
        pathInput.extend({
          field: z.enum(
            Object.keys(EXPERIMENT_POSITIONS) as [
              ExperimentPosition,
              ...ExperimentPosition[],
            ]
          ),
          text: z.string(),
          basedOn: z.string(),
          was: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) =>
        refusing(
          saveExperimentPosition(await requirePage(ctx), input.path, {
            ...input,
            at: ctx.now(),
            coalesceMs: ctx.coalesceMs,
          })
        )
      ),
    // One key in frontmatter; never a Revision (TEST-10).
    setStatus: t.procedure
      .input(
        pathInput.extend({
          status: z.enum(EXPERIMENT_STATUSES),
          basedOn: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) =>
        refusing(setExperimentStatus(await requirePage(ctx), input.path, input))
      ),
    // A why onto any entry of the page's history, as on the other pages.
    explainRevision: t.procedure
      .input(
        pathInput.extend({
          at: z.string().min(1),
          field: z.string().min(1),
          why: z.string().trim().min(1, "The why is empty."),
          basedOn: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) =>
        refusing(
          explainRevision(
            await requirePage(ctx),
            input.path,
            EXPERIMENT_PAGE,
            input
          )
        )
      ),
  }),
  researchQuestions: t.router({
    // The page: the file's body from disk, each link's resolution from the
    // index (`research-question.ts`).
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
          // The section's text as the page read it: what tells a stale
          // save that re-applies from one that would overwrite an edit
          // made to this section since (#215).
          was: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) =>
        refusing(saveSection(await requirePage(ctx), input.path, input))
      ),
    // Resolve or abandon (#222; ADR 0020 decision 6): the page's keys, then
    // the write-back to the Question it came from. Two results, because the
    // second can fail after the first landed — a page whose Question is gone
    // is resolved, and says what it could not write.
    resolve: t.procedure
      .input(pathInput.extend({ status: z.enum(["answered", "abandoned"]) }))
      .mutation(async ({ ctx, input }) =>
        refusing(
          resolveResearchQuestion(await requirePage(ctx), input.path, {
            status: input.status,
            at: localIso(ctx.now()),
          })
        )
      ),
    // Sharpen into a Hypothesis (#332): the page written from the typed
    // claim, then the sharpened line under Related questions, or the page
    // removed. The Research Question stays open.
    promoteToHypothesis: t.procedure
      .input(promoteToHypothesisInput)
      .mutation(({ ctx, input }) =>
        refusing(
          ctx.questions.promoteResearchQuestionToHypothesis(
            input.path,
            input.claim
          )
        )
      ),
    // Resolving is a status, not an archive: reopen puts the page back to
    // open and leaves every other byte — and the Question's line — alone.
    reopen: t.procedure
      .input(pathInput)
      .mutation(async ({ ctx, input }) =>
        refusing(reopenResearchQuestion(await requirePage(ctx), input.path))
      ),
    // A thread ticked in place, named by its text.
    tickThread: t.procedure
      .input(pathInput.extend({ text: z.string(), done: z.boolean() }))
      .mutation(async ({ ctx, input }) =>
        refusing(tickThread(await requirePage(ctx), input.path, input))
      ),
    // Attach a source to one side (#218): one `appendToSection` writing the
    // line grammar. The side is required and has no third value, so a form
    // that did not ask is an input error rather than a default.
    attachSource: t.procedure
      .input(
        pathInput.extend({
          target: z.string().min(1),
          side: z.enum(SIDES),
          // A note nobody wrote is the empty one, not a missing key.
          note: z.string().default(""),
          basedOn: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) =>
        refusing(attachSource(await requirePage(ctx), input.path, input))
      ),
    // Move a source to the other side, or detach it (#219): the line is
    // named by its text, not its position, so a file edited underneath
    // takes the move where it was meant or refuses. Neither records a
    // Revision (ADR 0020 decision 4).
    moveSource: t.procedure
      .input(
        pathInput.extend({
          from: z.enum(SIDES),
          text: z.string().min(1),
          basedOn: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) =>
        refusing(moveSource(await requirePage(ctx), input.path, input))
      ),
    detachSource: t.procedure
      .input(
        pathInput.extend({
          side: z.enum(SIDES),
          text: z.string().min(1),
          basedOn: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) =>
        refusing(detachSource(await requirePage(ctx), input.path, input))
      ),
    // The Working answer is the one Edited section that is also a Position:
    // its save records the Revision in the same write (#213).
    saveWorkingAnswer: t.procedure
      .input(
        pathInput.extend({
          text: z.string(),
          basedOn: z.string(),
          was: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) =>
        refusing(
          saveWorkingAnswer(await requirePage(ctx), input.path, {
            ...input,
            at: ctx.now(),
            coalesceMs: ctx.coalesceMs,
          })
        )
      ),
    // A why written onto a Revision (#216): the entry is named by its
    // timestamp, which is all an entry has, and `## Position history` is
    // rewritten whole to carry the line. The same call serves the why that
    // follows ⌥↵ and *+ why* on a quiet entry months later — the Revision
    // is already on disk in both, so a why never blocks a save.
    explainRevision: t.procedure
      .input(
        pathInput.extend({
          /** The Revision's `at`, verbatim as the page read it. */
          at: z.string().min(1),
          /** The Revision's field: the timestamp names an entry only within its field. */
          field: z.string().min(1),
          // A line nobody wrote is a decline, which the page makes by not
          // calling: an empty why here is a caller's mistake, not a Revision
          // to strip the `why:` line from.
          why: z.string().trim().min(1, "The why is empty."),
          basedOn: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) =>
        refusing(
          explainRevision(
            await requirePage(ctx),
            input.path,
            RESEARCH_QUESTION_PAGE,
            input
          )
        )
      ),
  }),
  // The maintenance dashboard (§ Loose Ends): the rows are index queries
  // plus `dismissals.json`, and *mark deliberate* and its undo are the only
  // writes.
  looseEnds: t.router({
    rows: t.procedure.query(async ({ ctx }) => {
      const { vault, index, days } = await requireVault(ctx);
      return looseEnds(index, vault.path, {
        days,
        stalledOpenDays: ctx.stalledOpenDays,
      });
    }),
    // Permanent, and judged per row kind: the same object can be loose in
    // more than one way, and each is silenced on its own.
    dismiss: t.procedure
      .input(z.object({ subject: z.string().min(1), kind: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const { vault } = await requireVault(ctx);
        await refusing(
          dismiss(
            vault.path,
            input.subject,
            input.kind,
            ctx.now().toISOString()
          )
        );
      }),
    // The way back, for as long as the row is still on screen (#266): the
    // one click in the dashboard that changes state is the one click that
    // has to be undoable.
    undismiss: t.procedure
      .input(z.object({ subject: z.string().min(1), kind: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const { vault } = await requireVault(ctx);
        await refusing(undismiss(vault.path, input.subject, input.kind));
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
    // Link (#211): the picker's choice appended to the Question's
    // `related`, one write through the protocol.
    link: t.procedure
      .input(linkInput)
      .mutation(({ ctx, input }) =>
        refusing(ctx.questions.link(input.path, input.target))
      ),
    // Promote to Research Question (#210): the page written whole, then
    // the Question marked; a refusal is the typed error the formatter
    // unpacks, shown on the row.
    promote: t.procedure
      .input(pathInput)
      .mutation(({ ctx, input }) =>
        refusing(ctx.questions.promote(input.path))
      ),
    // Promote to Hypothesis (#331): the typed claim names and fills the
    // page, written whole; then the Question marked, or the page removed.
    promoteToHypothesis: t.procedure
      .input(promoteToHypothesisInput)
      .mutation(({ ctx, input }) =>
        refusing(ctx.questions.promoteToHypothesis(input.path, input.claim))
      ),
    // The last three triage keys (#212): each is one write through the
    // protocol, each refusal the typed error the formatter unpacks.
    answer: t.procedure
      .input(answerInput)
      .mutation(({ ctx, input }) =>
        refusing(ctx.questions.answer(input.path, input.line))
      ),
    drop: t.procedure
      .input(pathInput)
      .mutation(({ ctx, input }) => refusing(ctx.questions.drop(input.path))),
    reopen: t.procedure
      .input(pathInput)
      .mutation(({ ctx, input }) => refusing(ctx.questions.reopen(input.path))),
  }),
});

// The contract the renderer imports type-only (ADR 0005).
export type AppRouter = typeof router;
