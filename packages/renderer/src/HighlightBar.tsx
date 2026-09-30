import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { HIGHLIGHT_COLOURS, type HighlightColour } from "./highlight-colour";
import type { PageSelection } from "./pdf-document";
import styles from "./Reader.module.css";
import { useTRPC } from "./trpc";

/**
 * What offers a highlight once text is selected (spec #416 stories 90–91):
 * one of the five colours and, optionally, a margin note. It sends an
 * *intent* — the page, the selection's rectangles in PDF user space, the
 * colour, the note — and nothing else; the quote, the quads and everything
 * written into the PDF are the core's (ADR 0007 decision 6). A refusal (a
 * selection over an image) is the core's own sentence, shown as it came, and
 * the selection stays so the reader can try another.
 */
export function HighlightBar({
  path,
  selection,
  onDone,
}: {
  path: string;
  selection: PageSelection;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [colour, setColour] = useState<HighlightColour>("yellow");
  const [note, setNote] = useState("");
  const make = useMutation(
    trpc.sources.highlight.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries(trpc.sources.page.pathFilter()),
          queryClient.invalidateQueries(trpc.sources.connections.pathFilter()),
        ]);
        window.getSelection()?.removeAllRanges();
        onDone();
      },
    })
  );
  return (
    <form
      className={styles.bar}
      aria-label="Highlight the selection"
      onSubmit={(event) => {
        event.preventDefault();
        make.mutate({
          path,
          page: selection.page,
          rects: selection.rects as [number, number, number, number][],
          colour,
          note: note.trim(),
        });
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onDone();
      }}
    >
      <div className={styles.swatches} role="group" aria-label="Colour">
        {HIGHLIGHT_COLOURS.map((name) => (
          <button
            key={name}
            type="button"
            className={`${styles.swatch} ${styles[name]}`}
            aria-label={name}
            aria-pressed={colour === name}
            onClick={() => setColour(name)}
          />
        ))}
      </div>
      <textarea
        className={styles.barNote}
        aria-label="Margin note"
        placeholder="Margin note (optional)"
        rows={1}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <button
        type="submit"
        className={styles.barAction}
        disabled={make.isPending}
      >
        Highlight
      </button>
      {make.isError && (
        <p className={styles.barSaid} role="status">
          {make.error.message}
        </p>
      )}
    </form>
  );
}
