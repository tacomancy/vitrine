import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReaderAnnotation } from "core";
import { useState } from "react";
import {
  HIGHLIGHT_COLOURS,
  snapColour,
  type HighlightColour,
} from "./highlight-colour";
import styles from "./Reader.module.css";
import { useTRPC } from "./trpc";

/** The kinds whose colour and note the Reader can change; a sticky note has neither. */
const MARKUP = new Set(["highlight", "underline", "strikeout", "squiggly"]);

/**
 * What can be done to one annotation from the margin (spec #416 stories
 * 104–109): recolour it, edit its margin note, remove it. There is no control
 * for its extent — resizing is remove and redraw, the Reader's one way to
 * change it. The renderer names the annotation and what to change; the PDF,
 * the identity and the Tombstone are the core's. A refusal is the core's own
 * sentence, on the annotation it was about.
 *
 * Removing something that points at it asks first, naming what does, and
 * says what will be left: a `(gone)` block, so every link still resolves.
 */
export function AnnotationControls({
  path,
  annotation,
}: {
  path: string;
  annotation: ReaderAnnotation;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const changed = () =>
    Promise.all([
      queryClient.invalidateQueries(trpc.sources.page.pathFilter()),
      queryClient.invalidateQueries(trpc.sources.connections.pathFilter()),
    ]);
  const amend = useMutation(
    trpc.sources.amend.mutationOptions({
      onSuccess: async () => {
        setEditing(null);
        await changed();
      },
    })
  );
  const remove = useMutation(
    trpc.sources.removeAnnotation.mutationOptions({
      // Not awaited: the question above closes on the answer, not on the
      // page being read again behind it.
      onSuccess: (result) => {
        if (result.outcome !== "confirm") void changed();
      },
    })
  );
  const asking = remove.data?.outcome === "confirm" ? remove.data : null;
  const isMarkup = MARKUP.has(annotation.kind);
  const said = amend.error?.message ?? remove.error?.message ?? null;

  return (
    <div className={styles.controls}>
      {isMarkup && (
        <div className={styles.swatches} role="group" aria-label="Recolour">
          {HIGHLIGHT_COLOURS.map((name: HighlightColour) => (
            <button
              key={name}
              type="button"
              className={`${styles.swatch} ${styles[name]}`}
              aria-label={name}
              aria-pressed={snapColour(annotation.color) === name}
              disabled={amend.isPending}
              onClick={() =>
                amend.mutate({
                  path,
                  annotation: annotation.id,
                  colour: name,
                })
              }
            />
          ))}
        </div>
      )}
      {editing !== null ? (
        <form
          className={styles.controlsRow}
          onSubmit={(event) => {
            event.preventDefault();
            amend.mutate({
              path,
              annotation: annotation.id,
              note: editing.trim(),
            });
          }}
        >
          <textarea
            className={styles.barNote}
            aria-label="Margin note"
            rows={2}
            value={editing}
            onChange={(event) => setEditing(event.target.value)}
          />
          <button
            type="submit"
            className={styles.barAction}
            disabled={amend.isPending}
          >
            Save note
          </button>
          <button
            type="button"
            className={styles.barAction}
            onClick={() => setEditing(null)}
          >
            Cancel
          </button>
        </form>
      ) : (
        <div className={styles.controlsRow}>
          {isMarkup && (
            <button
              type="button"
              className={styles.barAction}
              onClick={() => setEditing(annotation.note)}
            >
              Edit note
            </button>
          )}
          <button
            type="button"
            className={styles.barAction}
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate({
                path,
                annotation: annotation.id,
                confirmed: false,
              })
            }
          >
            Remove
          </button>
        </div>
      )}
      {asking !== null && (
        <div
          role="alertdialog"
          aria-label="Remove this annotation?"
          className={styles.controlsAsk}
        >
          <p className={styles.barSaid}>
            These point at it. Removing it leaves a (gone) block in the note, so
            every link still resolves:
          </p>
          <ul className={styles.notes}>
            {asking.links.map((link) => (
              <li key={link.path}>{link.title}</li>
            ))}
          </ul>
          <div className={styles.controlsRow}>
            <button
              type="button"
              className={styles.barAction}
              onClick={() =>
                remove.mutate({
                  path,
                  annotation: annotation.id,
                  confirmed: true,
                })
              }
            >
              Remove it
            </button>
            <button
              type="button"
              className={styles.barAction}
              onClick={() => remove.reset()}
            >
              Keep it
            </button>
          </div>
        </div>
      )}
      {said !== null && (
        <p className={styles.barSaid} role="status">
          {said}
        </p>
      )}
    </div>
  );
}
