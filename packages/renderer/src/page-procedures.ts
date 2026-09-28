import { useQueryClient } from "@tanstack/react-query";
import type { SavedAnswer, WriteResult } from "core";
import { useTRPC, useTRPCClient } from "./trpc";

/**
 * The page procedures a Position's field and a why line call, by Kind. The
 * Research Question's and the Hypothesis's pages call the core by
 * different names; everything else about editing a Position and
 * explaining a Revision is the same, so `PositionField.tsx` and
 * `WhyLine.tsx` are written once over this. The Kinds are one table typed
 * over every `HistoriedKind`, so a later Kind (an Experiment's design)
 * that is added to the union and not to the table fails to compile rather
 * than quietly calling another Kind's procedures.
 */

/**
 * Each Kind with a Position history, and the fields its page edits as text
 * — a Position, named as its Revisions carry it, or an Edited section saved
 * with no Revision at all (an Experiment's purpose and *where it ran*).
 */
type EditedFields = {
  "research-question": "working answer";
  hypothesis: "claim" | "design notes";
  experiment: "purpose" | "where it ran" | "design" | "observations";
};

/** The Experiment's text fields and the `##` sections they save whole. */
const EXPERIMENT_SECTIONS = {
  purpose: "Purpose",
  "where it ran": "Where it ran",
} as const;

/** The Kinds whose pages hold a Position history. */
export type HistoriedKind = keyof EditedFields;

/** One Position the page edits as text: its Kind, and its field. */
export type EditedPosition = {
  [K in HistoriedKind]: { kind: K; field: EditedFields[K] };
}[HistoriedKind];

/** What a field is editing against: the file's hash and the section's text, as it read them. */
export type Base = { hash: string; text: string };

/** The disk copy, or why there is none — a read that failed is a line, never a shrug. */
export type DiskCopy =
  { read: true; base: Base } | { read: false; reason: string };

type Save = { path: string; text: string; basedOn: string; was: string };
type Explain = {
  path: string;
  at: string;
  field: string;
  why: string;
  basedOn: string;
};

/** What one Kind's page answers to. `read` is afresh, never the cache. */
type Procedures<K extends HistoriedKind> = {
  reread: (path: string) => Promise<void>;
  explain: (input: Explain) => Promise<WriteResult>;
  save: (field: EditedFields[K], input: Save) => Promise<SavedAnswer>;
  read: (
    path: string,
    field: EditedFields[K]
  ) => Promise<
    { readable: true; base: Base } | { readable: false; reason: string }
  >;
};

/**
 * The page procedures, by Kind. The re-read is the page's own query; a
 * save or a why that landed invalidates it so the field and the history
 * show the file at once, as the own write's `vaultChanged` would a moment
 * later.
 */
export function usePageProcedures() {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const byKind: { [K in HistoriedKind]: Procedures<K> } = {
    "research-question": {
      reread: (path) =>
        queryClient.invalidateQueries(
          trpc.researchQuestions.page.queryFilter({ path })
        ),
      explain: (input) =>
        client.researchQuestions.explainRevision.mutate(input),
      save: (_field, input) =>
        client.researchQuestions.saveWorkingAnswer.mutate(input),
      read: async (path) => {
        const page = await queryClient.fetchQuery({
          ...trpc.researchQuestions.page.queryOptions({ path }),
          staleTime: 0,
        });
        if (!page.readable) return page;
        const text = page.sections.workingAnswer.text;
        return { readable: true, base: { hash: page.hash, text } };
      },
    },
    hypothesis: {
      reread: (path) =>
        queryClient.invalidateQueries(
          trpc.hypotheses.page.queryFilter({ path })
        ),
      explain: (input) => client.hypotheses.explainRevision.mutate(input),
      save: (field, input) =>
        client.hypotheses.savePosition.mutate({ ...input, field }),
      read: async (path, field) => {
        const page = await queryClient.fetchQuery({
          ...trpc.hypotheses.page.queryOptions({ path }),
          staleTime: 0,
        });
        if (!page.readable) return page;
        const { claim, designNotes } = page.sections;
        const text = field === "claim" ? claim.text : designNotes.text;
        return { readable: true, base: { hash: page.hash, text } };
      },
    },
    experiment: {
      reread: (path) =>
        queryClient.invalidateQueries(
          trpc.experiments.page.queryFilter({ path })
        ),
      explain: (input) => client.experiments.explainRevision.mutate(input),
      save: async (field, { text, ...input }) =>
        field === "design" || field === "observations"
          ? client.experiments.savePosition.mutate({ ...input, text, field })
          : // An Edited section records no Revision, so there is none to name.
            {
              ...(await client.experiments.saveSection.mutate({
                ...input,
                section: EXPERIMENT_SECTIONS[field],
                body: text,
              })),
              revision: null,
            },
      read: async (path, field) => {
        const page = await queryClient.fetchQuery({
          ...trpc.experiments.page.queryOptions({ path }),
          staleTime: 0,
        });
        if (!page.readable) return page;
        const { purpose, whereItRan, design, observations } = page.sections;
        const text = {
          purpose: purpose.text,
          "where it ran": whereItRan.text,
          design: design.text,
          observations: observations.text,
        }[field];
        return { readable: true, base: { hash: page.hash, text } };
      },
    },
  };
  // The one place a Position's Kind and field are taken apart: the table
  // is indexed by the Kind, and the field goes to that Kind's entry.
  const of = <K extends HistoriedKind>(position: {
    kind: K;
    field: EditedFields[K];
  }) => ({ procedures: byKind[position.kind] as Procedures<K>, ...position });
  return {
    reread: (kind: HistoriedKind, path: string) => byKind[kind].reread(path),
    explain: (kind: HistoriedKind, input: Explain) =>
      byKind[kind].explain(input),
    save: (position: EditedPosition, input: Save) => {
      const { procedures, field } = of(position);
      return procedures.save(field, input);
    },
    /**
     * The Position as the file holds it now — read afresh, not from the
     * page's cache, because the point of the read is that the cache is
     * behind (#215). `changedAndUnreapplyable` also covers a file that is
     * gone, so this read is where that case separates itself.
     */
    diskCopy: async (
      path: string,
      position: EditedPosition
    ): Promise<DiskCopy> => {
      try {
        const { procedures, field } = of(position);
        const read = await procedures.read(path, field);
        return read.readable
          ? { read: true, base: read.base }
          : { read: false, reason: read.reason };
      } catch (error) {
        return { read: false, reason: (error as Error).message };
      }
    },
  };
}
