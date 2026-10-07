import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Scout, ScoutRow } from "core";
import { useTRPC } from "./trpc";

export const toggled = (
  set: ReadonlySet<string>,
  key: string
): ReadonlySet<string> => {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
};

const without = (
  set: ReadonlySet<string>,
  key: string
): ReadonlySet<string> => {
  const next = new Set(set);
  next.delete(key);
  return next;
};

export const scoutKey = (id: string) => `scout:${id}`;

/**
 * What an act on a row did, said on the row it was about and left there: no
 * row disappears from under the cursor, and what happened is not a toast that
 * has gone by the time it is wanted (spec #511 story 58). A refusal is the
 * user's act turned down and so an alert; anything else is the app saying where
 * things now stand (ADR 0033 decision 1).
 */
export type Said = { text: string; refused: boolean };

export type RowActs = ReturnType<typeof useRowActs>;

/**
 * What a Scout Activity row can be told to do — pause or resume, change its
 * cadence, open its edit — in one place, so a button on the row and a key on
 * the chosen one are the same act and cannot come to differ. The writes are
 * the core's (`scouts.setPaused`, `scouts.setCadence`); each says what it did
 * on the row it was about. `hold` is called as an act is sent, before the
 * read it changes comes back, so the table keeps the order it was showing.
 *
 * A form or a menu is closed by `close…` and never by toggling it: an act can
 * finish after the researcher has already dismissed what it came from, and a
 * toggle then would open it again.
 */
export function useRowActs(hold: () => void) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [said, setSaid] = useState<ReadonlyMap<string, Said>>(new Map());
  // Which rows have their cadence menu open, or their edit, held by the row's
  // key so a re-sort leaves them open.
  const [cadenceOpen, setCadenceOpen] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [editing, setEditing] = useState<ReadonlySet<string>>(new Set());

  function say(key: string, note: Said) {
    setSaid((was) => new Map(was).set(key, note));
  }
  const reread = () =>
    void queryClient.invalidateQueries(trpc.scouts.pathFilter());
  const refused = (
    error: { message: string },
    { scoutId }: { scoutId: string }
  ) => say(scoutKey(scoutId), { refused: true, text: error.message });

  const changeCadence = useMutation(
    trpc.scouts.setCadence.mutationOptions({
      onSuccess: ({ dueAtNextCheck }, { scoutId, cadence }) => {
        // Said from the write's own answer, which asked the scheduler: a row
        // that said a run was coming would otherwise be guessing at it.
        say(scoutKey(scoutId), {
          refused: false,
          text: `Cadence is now ${cadence}.${dueAtNextCheck ? " It is due at the next check." : ""}`,
        });
        reread();
      },
      onError: refused,
    })
  );
  const pause = useMutation(
    trpc.scouts.setPaused.mutationOptions({
      onSuccess: (_done, { scoutId, paused }) => {
        say(scoutKey(scoutId), {
          refused: false,
          text: paused
            ? "Paused. It will not run until you resume it."
            : "Resumed. It runs again when it is due.",
        });
        reread();
      },
      onError: refused,
    })
  );

  return {
    said,
    cadenceOpen,
    editing,
    say,
    hold,
    toggleEdit: (key: string) => setEditing((was) => toggled(was, key)),
    closeEdit: (key: string) => setEditing((was) => without(was, key)),
    toggleCadence: (key: string) => setCadenceOpen((was) => toggled(was, key)),
    closeCadence: (key: string) => setCadenceOpen((was) => without(was, key)),
    pauseOrResume(row: ScoutRow) {
      hold();
      pause.mutate({ scoutId: row.id, paused: !row.paused });
    },
    /** The menu closes on a choice; the cadence the Scout already has is no change, and a write that did nothing would only rewrite its file. */
    pickCadence(row: ScoutRow, cadence: Scout["cadence"]) {
      setCadenceOpen((was) => without(was, scoutKey(row.id)));
      if (cadence === row.cadence) return;
      hold();
      changeCadence.mutate({ scoutId: row.id, cadence });
    },
  };
}
