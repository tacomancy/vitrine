import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import { HIGHLIGHT_COLOURS } from "./highlight-colour.js";
import {
  addArtifact,
  artifactPreview,
  checkArtifacts,
  inspectArtifact,
  showStoredArtifact,
} from "./artifact.js";
import type { ArxivClient } from "./arxiv.js";
import type { WatchedDeps } from "./watched.js";
import type { Events } from "./events.js";
import type { Host } from "./host.js";
import { destinations } from "./destinations.js";
import { dismiss, undismiss } from "./dismissals.js";
import {
  addCriterion,
  attachEvidence,
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
  criteriaToAttach,
  EDITED_SECTIONS as EXPERIMENT_SECTIONS,
  FACETS as EXPERIMENT_FACETS,
  listExperiments,
  PAGE as EXPERIMENT_PAGE,
  POSITIONS as EXPERIMENT_POSITIONS,
  readExperimentPage,
  saveExperimentPosition,
  saveExperimentSection,
  type ExperimentPosition,
  setExperimentStatus,
  SORTS as EXPERIMENT_SORTS,
  STATUSES as EXPERIMENT_STATUSES,
} from "./experiment.js";
import { explainRevision } from "./page-write.js";
import { listQuestions } from "./list.js";
import { looseEnds } from "./loose-ends.js";
import { pauseScout, readScouts } from "./scout-file.js";
import { readFleetClaim, readHealth } from "./scout-health.js";
import { saveScout, setPaused, tryQuery } from "./scout-form.js";
import { checkDue } from "./scout-schedule.js";
import {
  acceptProposal,
  readQueue,
  readSkim,
  runScout,
  type ScoutDeps,
} from "./scouts.js";
import {
  acceptCounts,
  deferProposal,
  promoteProposal,
  readGroups,
  rejectProposal,
  rejectRun,
  undoTriage,
} from "./triage.js";
import { discardCopy, useCopy } from "./pdf-plumbing.js";
import { wikilinkTo } from "./link-text.js";
import { candidates } from "./picker.js";
import {
  attachPdf,
  detachPdf,
  locatePdf,
  createSourceFromPdf,
  createSourceStub,
  retryUnreadable,
  unnamedPdfs,
  type PdfReads,
} from "./sources.js";
import type { QuestionService } from "./questions.js";
import { localIso } from "./time.js";
import { VaultError } from "./errors.js";
import type { VaultService } from "./vault.js";
import {
  attachSource,
  dateOf,
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
import {
  amendAnnotation,
  bringDown,
  makeHighlight,
  removeAnnotation,
  makeQuestion,
  readConnections,
  readSourcePage,
  setReadingPosition,
} from "./reader.js";
import { kindsHeld } from "./vault-kinds.js";
import { outlineFromIndex } from "./vault-outline.js";
import { tagTree } from "./vault-tags.js";

export type Context = {
  vault: VaultService;
  questions: QuestionService;
  events: Events;
  /** The clock a Revision is stamped by, and ADR 0006 decision 5's window; both pinned by tests. */
  now: () => Date;
  /** The one arXiv client every Scout shares (ADR 0016 decision 3). */
  arxiv: ArxivClient;
  /** Fetch, model and key for a Scout that watches a page (ADR 0017). */
  watched: WatchedDeps;
  /** This machine's computer name, which a linked Artifact records (ADR 0035 decision 5); tests pass any string. */
  machine: string;
  coalesceMs: number;
  /** How many open days a promoted Research Question may sit unsourced (#243); tests shorten it. */
  stalledOpenDays: number;
  /** The id source for an object the router makes itself (an Experiment); pinned by tests. */
  newId: () => string;
  /** The PDF engine and what it could not read (#418). */
  pdfs: PdfReads;
  /** The shell's choosers: *+ artifact*'s file chooser is asked for here (ADR 0035). */
  host: Host;
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
// (#221, #339), resolving one — the follow-up its result raised — or
// observing an Experiment, the run the wondering came from (#373). `strict`
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
    z
      .object({
        context: z.literal("observing"),
        /** The Experiment's vault-relative path. */
        experiment: z.string().min(1),
      })
      .strict(),
    z
      .object({
        context: z.literal("reading"),
        /** The Source's vault-relative path. */
        source: z.string().min(1),
        /** The page in view, 1-based. */
        page: z.number().int().min(1),
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

/** What a Scout's run, read or accept needs of the open vault. */
async function scoutDeps(ctx: Context): Promise<ScoutDeps> {
  const { vault, index, queue } = await requireVault(ctx);
  return {
    vaultPath: vault.path,
    index,
    queue,
    arxiv: ctx.arxiv,
    watched: ctx.watched,
    events: ctx.events,
    now: ctx.now,
  };
}

/**
 * A triage act is synchronous, so a refusal it throws would escape as a throw
 * and not a rejection; the async wrapper makes it one, and `refusing` can
 * then turn it into the same BAD_REQUEST every other refusal is.
 */
function triaged<T>(ctx: Context, act: (deps: ScoutDeps) => T): Promise<T> {
  return refusing((async () => act(await scoutDeps(ctx)))());
}

/** What a page write needs of the open vault (`research-question.ts`). */
async function requirePage(ctx: Context): Promise<PageContext> {
  const { vault, index, pending } = await requireVault(ctx);
  return { vaultPath: vault.path, index, pending };
}

const resolveInput = z.object({
  source: z.string().min(1),
  annotations: z.array(z.string().min(1)).min(1),
});

/** A core started without an engine has nothing to resolve. */
function requireIngest<T>(ingest: T | null): T {
  if (ingest === null) {
    throw new VaultError("refused", "This core cannot read PDFs.");
  }
  return ingest;
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
      const folder = await ctx.vault.pdfFolder();
      if (folder === null) throw noVault();
      return folder;
    }),
    // The footer channel's *papers not arriving* (#379), on every surface:
    // the fault alone, so no surface walks the folder to learn it.
    pdfFault: t.procedure.query(async ({ ctx }) => {
      await requireVault(ctx);
      return ctx.vault.pdfFault();
    }),
    // The footer's *check again* on *papers not arriving* (#379): the sweep,
    // and the PDF folder checked and raised on the event stream. It looks
    // and changes nothing — no more a setter than `pdfFolder` is.
    checkAgain: t.procedure.mutation(async ({ ctx }) => {
      await requireVault(ctx);
      await ctx.vault.checkAgain();
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
  // The Scout Queue (beat 6, #448): a Scout is a file read as found, a run
  // turns what arXiv holds into Proposals, and accept is the one write.
  scouts: t.router({
    list: t.procedure.query(async ({ ctx }) => {
      const { vault } = await requireVault(ctx);
      return refusing(readScouts(vault.path));
    }),
    runNow: t.procedure
      .input(z.object({ scoutId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) =>
        refusing(runScout(await scoutDeps(ctx), input.scoutId))
      ),
    // Loose Ends' way out of a broken Scout: it stops looking, and its row
    // goes with the failure it was about (`healthOf` answers *paused*).
    pause: t.procedure
      .input(z.object({ scoutId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const { vault } = await requireVault(ctx);
        await refusing(pauseScout(vault.path, input.scoutId));
      }),
    queue: t.procedure.query(async ({ ctx }) =>
      refusing(readQueue(await scoutDeps(ctx)))
    ),
    // Skim: the quiet lane, split at 30 days; *to Review* is the one act on it.
    skim: t.procedure.query(async ({ ctx }) =>
      refusing(readSkim(await scoutDeps(ctx)))
    ),
    promote: t.procedure
      .input(z.object({ proposalId: z.number().int() }))
      .mutation(({ ctx, input }) =>
        triaged(ctx, (deps) => promoteProposal(deps, input.proposalId))
      ),
    // Accept and reject counts as the Accept rate will read them (beat 9).
    acceptCounts: t.procedure.query(async ({ ctx }) =>
      acceptCounts((await scoutDeps(ctx)).queue)
    ),
    // What an empty Review or Skim may claim, from the whole fleet.
    fleet: t.procedure.query(async ({ ctx }) =>
      refusing(readFleetClaim(await scoutDeps(ctx)))
    ),
    // How each Scout is doing, in its Voice (ADR 0032): derived from the run
    // rows on every read, so no surface keeps a copy that could disagree.
    health: t.procedure.query(async ({ ctx }) =>
      refusing(readHealth(await scoutDeps(ctx)))
    ),
    // The scheduled check by name: what the hourly timer and a vault open
    // run, so a caller can ask for it at a moment of its choosing.
    checkDue: t.procedure.mutation(async ({ ctx }) =>
      refusing(checkDue(await scoutDeps(ctx)))
    ),
    // The form (#451): the file written, a Query edit run at once.
    save: t.procedure
      .input(
        z.object({
          id: z.string().min(1).optional(),
          name: z.string(),
          query: z.string(),
          cadence: z.enum(["daily", "weekly", "monthly"]),
          assigned: z.array(z.string()),
          lane: z.enum(["review", "skim"]),
          searchBackTo: z.string().datetime().nullable(),
        })
      )
      .mutation(async ({ ctx, input }) =>
        refusing(saveScout(await scoutDeps(ctx), input))
      ),
    setPaused: t.procedure
      .input(z.object({ scoutId: z.string().min(1), paused: z.boolean() }))
      .mutation(async ({ ctx, input }) =>
        refusing(setPaused(await scoutDeps(ctx), input.scoutId, input.paused))
      ),
    tryQuery: t.procedure
      .input(z.object({ query: z.string() }))
      .mutation(async ({ ctx, input }) =>
        refusing(tryQuery(await scoutDeps(ctx), input.query))
      ),
    accept: t.procedure
      .input(z.object({ proposalId: z.number().int() }))
      .mutation(async ({ ctx, input }) =>
        refusing(acceptProposal(await scoutDeps(ctx), input.proposalId))
      ),
    // What each Scout's group says beside the cards (#450).
    groups: t.procedure.query(async ({ ctx }) =>
      refusing(readGroups(await scoutDeps(ctx)))
    ),
    reject: t.procedure
      .input(z.object({ proposalId: z.number().int() }))
      .mutation(({ ctx, input }) =>
        triaged(ctx, (deps) => rejectProposal(deps, input.proposalId))
      ),
    defer: t.procedure
      .input(z.object({ proposalId: z.number().int() }))
      .mutation(({ ctx, input }) =>
        triaged(ctx, (deps) => deferProposal(deps, input.proposalId))
      ),
    undo: t.procedure
      .input(z.object({ proposalId: z.number().int() }))
      .mutation(({ ctx, input }) =>
        triaged(ctx, (deps) => undoTriage(deps, input.proposalId))
      ),
    rejectRun: t.procedure
      .input(z.object({ runId: z.number().int() }))
      .mutation(({ ctx, input }) =>
        triaged(ctx, (deps) => ({ rejected: rejectRun(deps, input.runId) }))
      ),
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
    // The PDFs no Source names yet: what a stub's *attach a PDF* chooses from.
    unnamedPdfs: t.procedure.query(async ({ ctx }) => {
      const { index } = await requireVault(ctx);
      return unnamedPdfs(index);
    }),
    // *Attach to a stub* on a no-Source row (#417): the one write that makes
    // a stub a Source once it has its file.
    attachToStub: t.procedure
      .input(z.object({ pdf: z.string().min(1), stub: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const { vault, index } = await requireVault(ctx);
        return refusing(
          attachPdf(vault.path, index, input, ctx.newId, ctx.vault.ingest)
        );
      }),
    // *Create a Source* on a no-Source row (#418): title and authors from
    // the PDF's own metadata. A file the engine cannot read is an answer,
    // not an error: `readable: false` and the reason.
    createFromFile: t.procedure
      .input(z.object({ pdf: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const { vault, index } = await requireVault(ctx);
        return refusing(
          createSourceFromPdf(vault.path, index, input, {
            reads: ctx.pdfs,
            newId: ctx.newId,
            ingest: ctx.vault.ingest,
          })
        );
      }),
    // The Reader (#424): a Source's fields, its PDF's address and the
    // annotations the overlay draws, read off the note and the sidecar.
    page: t.procedure.input(pathInput).query(async ({ ctx, input }) => {
      const { vault, index } = await requireVault(ctx);
      return refusing(readSourcePage(vault.path, index, input.path));
    }),
    // What points at this paper and its highlights (#425).
    connections: t.procedure.input(pathInput).query(async ({ ctx, input }) => {
      const { vault, index } = await requireVault(ctx);
      return refusing(readConnections(vault.path, index, input.path));
    }),
    // Opening an evicted PDF brings it down and then ingests it (story 24).
    bringDown: t.procedure.input(pathInput).mutation(async ({ ctx, input }) => {
      const { vault, index } = await requireVault(ctx);
      return refusing(
        bringDown(vault.path, index, ctx.vault.ingest, input.path)
      );
    }),
    // Where the reader stopped, remembered per Source (story 75).
    readingPosition: t.procedure
      .input(
        pathInput.extend({
          page: z.number().int().min(1),
          offset: z.number().min(0).max(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { vault, ingest } = await requireVault(ctx);
        return refusing(
          setReadingPosition(vault.path, ingest, input.path, {
            page: input.page,
            offset: input.offset,
          })
        );
      }),
    // A highlight from the Reader, with an optional margin note (#426). The
    // renderer sends where and what colour; the quote comes back from the
    // core's own characters, never from the selection.
    highlight: t.procedure
      .input(
        pathInput.extend({
          page: z.number().int().min(1),
          rects: z
            .array(z.tuple([z.number(), z.number(), z.number(), z.number()]))
            .min(1),
          colour: z.enum(HIGHLIGHT_COLOURS),
          note: z.string().max(10_000).default(""),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { vault, ingest } = await requireVault(ctx);
        const { path, ...intent } = input;
        return refusing(makeHighlight(vault.path, ingest, path, intent));
      }),
    // A Question from a selection: the `Q:` highlight and the Question, made
    // together (#427; ADR 0038).
    question: t.procedure
      .input(
        pathInput.extend({
          page: z.number().int().min(1),
          rects: z
            .array(z.tuple([z.number(), z.number(), z.number(), z.number()]))
            .min(1),
          text: z.string().trim().min(1, "Question text is empty."),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { vault, ingest } = await requireVault(ctx);
        const { path, ...intent } = input;
        return refusing(makeQuestion(vault.path, ingest, path, intent));
      }),
    // Recolour and re-note an annotation (#428). Extent is not changeable:
    // the Reader's one way to resize is remove and redraw.
    amend: t.procedure
      .input(
        pathInput.extend({
          annotation: z.string().min(1),
          colour: z.enum(HIGHLIGHT_COLOURS).optional(),
          note: z.string().max(10_000).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { vault, ingest } = await requireVault(ctx);
        const { path, annotation, colour, note } = input;
        await refusing(
          amendAnnotation(vault.path, ingest, path, annotation, {
            ...(colour === undefined ? {} : { colour }),
            ...(note === undefined ? {} : { note }),
          })
        );
      }),
    // Remove an annotation; a linked one answers `confirm` until asked again
    // with `confirmed` (#428).
    removeAnnotation: t.procedure
      .input(
        pathInput.extend({
          annotation: z.string().min(1),
          confirmed: z.boolean().default(false),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { vault, ingest } = await requireVault(ctx);
        return refusing(
          removeAnnotation(
            vault.path,
            ingest,
            input.path,
            input.annotation,
            input.confirmed
          )
        );
      }),
    // *Locate* and *detach* on a *PDF missing* row (#423).
    locate: t.procedure
      .input(z.object({ source: z.string().min(1), pdf: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const { vault, index } = await requireVault(ctx);
        return refusing(
          locatePdf(vault.path, index, ctx.pdfs, ctx.vault.ingest, input)
        );
      }),
    detach: t.procedure
      .input(z.object({ source: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const { vault, index } = await requireVault(ctx);
        return refusing(detachPdf(vault.path, index, input));
      }),
    // *Use this copy* and *discard* on a *conflict copy* row (#423): one
    // procedure, since the file is the same and the answer is the choice.
    // Named for the conflict, not the copy, because the folder's promise is
    // that nothing in the router copies into it (`pdf-folder.test.ts`).
    resolveConflict: t.procedure
      .input(
        z.object({
          copy: z.string().min(1),
          resolution: z.enum(["use", "discard"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { vault, index } = await requireVault(ctx);
        return refusing(
          input.resolution === "use"
            ? useCopy(vault.path, index, ctx.pdfs, ctx.vault.ingest, input)
            : discardCopy(vault.path, index, ctx.pdfs, ctx.host, input)
        );
      }),
    // *Try again* on a *PDF unreadable* row: the engine runs once, now.
    tryAgain: t.procedure
      .input(z.object({ pdf: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const { vault, index } = await requireVault(ctx);
        return refusing(retryUnreadable(vault.path, index, input, ctx.pdfs));
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
    // suffixed; the name is the Experiment's folder. `from` is the path of
    // what prompted it — a Hypothesis, from a Criterion (#371).
    create: t.procedure
      .input(z.object({ name: z.string(), from: z.string().min(1).optional() }))
      .mutation(async ({ ctx, input }) => {
        const { vault, index } = await requireVault(ctx);
        return refusing(
          createExperiment(vault.path, index, input.name, {
            created: localIso(ctx.now()),
            newId: ctx.newId,
            ...(input.from === undefined ? {} : { from: input.from }),
          })
        );
      }),
    page: t.procedure.input(pathInput).query(async ({ ctx, input }) => {
      const { vault, index } = await requireVault(ctx);
      return refusing(readExperimentPage(index, vault.path, input.path));
    }),
    // The surface's views (#372): the Experiment Inbox by default, its two
    // halves, and every run by status — derived on each read, never stored.
    // `seed` holds a shuffle still across re-reads.
    inbox: t.procedure
      .input(
        z.object({
          facet: z.enum(EXPERIMENT_FACETS),
          status: z.enum(EXPERIMENT_STATUSES).optional(),
          project: z.string().optional(),
          sort: z.enum(EXPERIMENT_SORTS),
          seed: z.number().int().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const { vault, index } = await requireVault(ctx);
        return listExperiments(index, vault.path, input);
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
    // What *attach as evidence* offers (#367): every Hypothesis's Criteria,
    // grouped by Hypothesis, falsifying first.
    criteria: t.procedure.query(async ({ ctx }) => {
      const { vault, index } = await requireVault(ctx);
      return criteriaToAttach(index, vault.path);
    }),
    // A run attached to one Criterion (#367; TEST-12): written on the
    // Hypothesis, through its criterion write path — a Revision of that
    // Criterion, never an Outcome. The note's emptiness is the core's to
    // refuse, in its words, so the input takes any string.
    attachEvidence: t.procedure
      .input(
        z.object({
          hypothesis: z.string().min(1),
          criterion: z.string().min(1),
          experiment: z.string().min(1),
          note: z.string(),
          basedOn: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) =>
        refusing(
          attachEvidence(await requirePage(ctx), input.hypothesis, {
            id: input.criterion,
            experiment: input.experiment,
            note: input.note,
            basedOn: input.basedOn,
            at: ctx.now(),
            coalesceMs: ctx.coalesceMs,
          })
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
    // *+ artifact*'s chooser: one file of any type, or null when cancelled.
    // The path goes back to the page, which asks for the caption before
    // anything is copied.
    pickArtifact: t.procedure.mutation(async ({ ctx }) => ({
      source: await ctx.host.pickFile(),
    })),
    // Stored or linked, proposed by size (ADR 0035 decision 4): asked
    // before the caption, so the page can say which it will be and offer
    // the other.
    inspectArtifact: t.procedure
      .input(z.object({ source: z.string().min(1) }))
      .query(({ input }) => refusing(inspectArtifact(input.source))),
    // An Artifact as the user chose it, whatever was proposed (story 31).
    // Stored (ADR 0035 decision 1): the file copied into the run's folder,
    // then its line; a line that cannot be written comes back as the
    // write's refusal, with the file already in the folder. Linked
    // (decision 5): the line alone, with this machine and the Fingerprint.
    // `as` has no default, so no caller stores a 2 GB file by leaving it out.
    addArtifact: t.procedure
      .input(
        pathInput.extend({
          source: z.string().min(1),
          as: z.enum(["stored", "linked"]),
          caption: z.string().trim().min(1, "An Artifact needs a caption."),
        })
      )
      .mutation(async ({ ctx, input }) =>
        refusing(
          addArtifact(
            await requirePage(ctx),
            EXPERIMENT_PAGE,
            input.path,
            input,
            {
              machine: ctx.machine,
              today: dateOf(localIso(ctx.now())),
            }
          )
        )
      ),
    // *show it here* (ADR 0035 decision 3): the line for a file already in
    // the run's folder, and nothing copied. No procedure removes a line,
    // or deletes, moves or copies out an Artifact (decision 2).
    showArtifact: t.procedure
      .input(
        pathInput.extend({
          file: z.string().min(1),
          caption: z.string().trim().min(1, "An Artifact needs a caption."),
        })
      )
      .mutation(async ({ ctx, input }) =>
        refusing(
          showStoredArtifact(
            await requirePage(ctx),
            EXPERIMENT_PAGE,
            input.path,
            input
          )
        )
      ),
    // A CSV, TSV or text Artifact's first rows, `file` as its line names it.
    artifactPreview: t.procedure
      .input(pathInput.extend({ file: z.string().min(1) }))
      .query(async ({ ctx, input }) =>
        refusing(
          artifactPreview(
            await requirePage(ctx),
            EXPERIMENT_PAGE,
            input.path,
            input.file
          )
        )
      ),
    // TEST-13 (#370; ADR 0035 decisions 6–7): each linked Artifact read
    // back as here and unchanged, on another machine, changed or gone, or a
    // URL not checked here — shown beside the attach, and never a reason
    // to refuse it. Asked when the note opens, before the line is written.
    checkArtifacts: t.procedure
      .input(pathInput)
      .query(async ({ ctx, input }) =>
        refusing(
          checkArtifacts(
            await requirePage(ctx),
            EXPERIMENT_PAGE,
            input.path,
            ctx.machine
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
      const { vault, index, days, queue } = await requireVault(ctx);
      return looseEnds(index, vault.path, {
        queue,
        now: ctx.now(),
        days,
        stalledOpenDays: ctx.stalledOpenDays,
        machine: ctx.machine,
        reads: ctx.pdfs,
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
  // The three resolutions of an Unmatched annotation (#421; spec #416
  // stories 47–55). Behind Ingest's own queue; a batch names every
  // annotation of a document-changed group and is one act.
  unmatched: t.router({
    relink: t.procedure
      .input(
        z.object({
          source: z.string().min(1),
          annotation: z.string().min(1),
          candidate: z.string().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { ingest } = await requireVault(ctx);
        return refusing(
          requireIngest(ingest).relink(
            input.source,
            input.annotation,
            input.candidate
          )
        );
      }),
    dropLinks: t.procedure
      .input(resolveInput)
      .mutation(async ({ ctx, input }) => {
        const { ingest } = await requireVault(ctx);
        return refusing(
          requireIngest(ingest).dropLinks(input.source, input.annotations)
        );
      }),
    treatAsNew: t.procedure
      .input(resolveInput)
      .mutation(async ({ ctx, input }) => {
        const { ingest } = await requireVault(ctx);
        return refusing(
          requireIngest(ingest).treatAsNew(input.source, input.annotations)
        );
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
