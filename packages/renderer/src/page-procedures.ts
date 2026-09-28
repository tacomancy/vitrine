import { useQueryClient } from "@tanstack/react-query";
import type { WriteResult } from "core";
import { useTRPC, useTRPCClient } from "./trpc";

/**
 * The page procedures a Position's field and a why line call, by Kind. The
 * Research Question's and the Hypothesis's pages call the core by
 * different names; everything else about editing a Position and
 * explaining a Revision is the same, so `PositionField.tsx` and
 * `WhyLine.tsx` are written once over this and a later Kind (an
 * Experiment's design) adds a case rather than a copy.
 */

/** The Kinds whose pages hold a Position history. */
export type HistoriedKind = "research-question" | "hypothesis";

/** Each Kind's Positions that the page edits as text, by the field name their Revisions carry. */
export type EditedPosition =
  | { kind: "research-question"; field: "working answer" }
  | { kind: "hypothesis"; field: "claim" | "design notes" };

/** What a field is editing against: the file's hash and the section's text, as it read them. */
export type Base = { hash: string; text: string };

/** The disk copy, or why there is none — a read that failed is a line, never a shrug. */
export type DiskCopy =
  { read: true; base: Base } | { read: false; reason: string };

/**
 * The page procedures a Kind's field and why line call, chosen by Kind.
 * The re-read is the page's own query; a save or a why that landed
 * invalidates it so the field and the history show the file at once, as
 * the own write's `vaultChanged` would a moment later.
 */
export function usePageProcedures(kind: HistoriedKind) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  /** The page's text for one Position, and its hash, read afresh. */
  const readAfresh = async (
    path: string,
    position: EditedPosition
  ): Promise<
    { readable: true; base: Base } | { readable: false; reason: string }
  > => {
    if (position.kind === "hypothesis") {
      const page = await queryClient.fetchQuery({
        ...trpc.hypotheses.page.queryOptions({ path }),
        staleTime: 0,
      });
      if (!page.readable) return page;
      const { claim, designNotes } = page.sections;
      const text = position.field === "claim" ? claim.text : designNotes.text;
      return { readable: true, base: { hash: page.hash, text } };
    }
    const page = await queryClient.fetchQuery({
      ...trpc.researchQuestions.page.queryOptions({ path }),
      staleTime: 0,
    });
    if (!page.readable) return page;
    return {
      readable: true,
      base: { hash: page.hash, text: page.sections.workingAnswer.text },
    };
  };
  return {
    reread: (path: string) =>
      kind === "hypothesis"
        ? queryClient.invalidateQueries(
            trpc.hypotheses.page.queryFilter({ path })
          )
        : queryClient.invalidateQueries(
            trpc.researchQuestions.page.queryFilter({ path })
          ),
    explain: (input: {
      path: string;
      at: string;
      why: string;
      basedOn: string;
    }): Promise<WriteResult> =>
      kind === "hypothesis"
        ? client.hypotheses.explainRevision.mutate(input)
        : client.researchQuestions.explainRevision.mutate(input),
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
        const read = await readAfresh(path, position);
        return read.readable
          ? { read: true, base: read.base }
          : { read: false, reason: read.reason };
      } catch (error) {
        return { read: false, reason: (error as Error).message };
      }
    },
  };
}
