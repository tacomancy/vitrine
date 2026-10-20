import {
  Annotation,
  ChangeSet,
  EditorState,
  type ChangeSpec,
} from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useEffect, useRef } from "react";
import styles from "./Vault.module.css";

/** Obsidian's pause: typing that stops for this long is saved. */
export const IDLE_MS = 2000;

/** A file as the editor holds it: where a save goes, the LF text, and the hash that text was read or written at. */
export type EditorFile = { path: string; text: string; hash: string };

/**
 * What a save came to: the hash of what is now on disk and its text, LF
 * throughout. The text can differ from what was sent — the core records a
 * Revision in the same write (ADR 0015 decision 3) — and the editor takes
 * that in, or its next save would write the file back without it. Null when
 * the save was refused or failed; the caller has said so.
 */
export type SavedText = { hash: string; text: string } | null;

/** Marks a transaction that is not the user's typing: a file pushed in, a Revision taken back. */
const fromDisk = Annotation.define<true>();

/** The one splice that turns `from` into `to`: everything between their common head and tail. */
function spliceBetween(from: string, to: string): ChangeSpec {
  let head = 0;
  while (head < from.length && head < to.length && from[head] === to[head]) {
    head++;
  }
  let tail = 0;
  while (
    tail < from.length - head &&
    tail < to.length - head &&
    from[from.length - 1 - tail] === to[to.length - 1 - tail]
  ) {
    tail++;
  }
  return {
    from: head,
    to: from.length - tail,
    insert: to.slice(head, to.length - tail),
  };
}

/**
 * One `EditorView`, for the life of the surface (`docs/architecture.md`
 * § Vault surface, *Editor*). It is created once and the document is pushed
 * in with a single whole-document `dispatch`, and only when the *file*
 * changes: React never re-renders per keystroke and never owns the text.
 *
 * Save (#693): on a short idle, on ⌘S, on blur, and before another file
 * replaces the document, each `basedOn` the hash of the text last read from
 * or written to disk. The text is the editor's LF text; the file's CRLF and
 * BOM are the core's to restore around a save, so nothing here needs
 * `lineSeparator` yet. There is no undo history until the editor's
 * extensions land.
 */
export function VaultEditor({
  file,
  save,
}: {
  file: EditorFile | null;
  save: (path: string, content: string, basedOn: string) => Promise<SavedText>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // What the document is a copy of: the file, and the hash `basedOn` names.
  const held = useRef<{ path: string; hash: string } | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // One save at a time. `typed` is what the user did to the document since
  // the save took its text, so the Revision the core wrote can be mapped
  // past it instead of clobbering it.
  const saving = useRef<{ typed: ChangeSet; again: boolean } | null>(null);
  const saveRef = useRef(save);
  const flushRef = useRef<() => Promise<void>>(() => Promise.resolve());

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useEffect(() => {
    flushRef.current = async () => {
      clearTimeout(timer.current);
      const current = view.current;
      const target = held.current;
      if (current === null || target === null || !dirty.current) return;
      if (saving.current !== null) {
        saving.current.again = true;
        return;
      }
      const sent = current.state.doc.toString();
      const run = { typed: ChangeSet.empty(sent.length), again: false };
      saving.current = run;
      let saved: SavedText = null;
      try {
        saved = await saveRef.current(target.path, sent, target.hash);
      } finally {
        saving.current = null;
      }
      // Refused: the typing stays, dirty, for the caller's line to explain.
      if (saved === null) return;
      const here = held.current;
      // Another file replaced the document, or the surface closed, while
      // this save was out; its hash belongs to a file the editor no longer
      // holds. Typing in the new file that asked to save meanwhile still goes.
      if (
        view.current !== current ||
        here === null ||
        here.path !== target.path
      ) {
        if (run.again && dirty.current) void flushRef.current();
        return;
      }
      held.current = { path: target.path, hash: saved.hash };
      if (saved.text !== sent) {
        current.dispatch({
          changes: ChangeSet.of(
            spliceBetween(sent, saved.text),
            sent.length
          ).map(run.typed),
          annotations: fromDisk.of(true),
        });
      }
      dirty.current = !run.typed.empty;
      if (dirty.current && run.again) void flushRef.current();
    };
  });

  useEffect(() => {
    const parent = host.current;
    if (parent === null) return;
    const created = new EditorView({
      parent,
      state: EditorState.create({
        doc: "",
        extensions: [
          EditorView.contentAttributes.of({
            "aria-label": "Editor",
            role: "textbox",
            "aria-multiline": "true",
          }),
          EditorView.lineWrapping,
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                void flushRef.current();
                return true;
              },
            },
          ]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            if (update.transactions.some((t) => t.annotation(fromDisk))) return;
            dirty.current = true;
            const run = saving.current;
            if (run !== null) run.typed = run.typed.compose(update.changes);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => void flushRef.current(), IDLE_MS);
          }),
          EditorView.domEventHandlers({
            blur: () => {
              void flushRef.current();
            },
          }),
        ],
      }),
    });
    view.current = created;
    return () => {
      // Typing the idle timer had not yet saved still goes out; the view is
      // read before it is destroyed.
      void flushRef.current();
      clearTimeout(timer.current);
      created.destroy();
      view.current = null;
    };
  }, []);

  const { path, text, hash } = file ?? { path: null, text: "", hash: "" };
  useEffect(() => {
    const current = view.current;
    if (current === null || path === null) return;
    const switching = held.current?.path !== path;
    // Typing in flight, or the hash of the app's own write coming back from
    // a re-read, is not a new file to take in.
    if (!switching && (dirty.current || held.current?.hash === hash)) return;
    // The last file's unsaved typing goes out before its document is gone:
    // the save reads the text now, before the dispatch below.
    if (switching) void flushRef.current();
    held.current = { path, hash };
    dirty.current = false;
    clearTimeout(timer.current);
    if (current.state.doc.toString() === text) return;
    current.dispatch({
      changes: { from: 0, to: current.state.doc.length, insert: text },
      annotations: fromDisk.of(true),
    });
  }, [path, text, hash]);

  return <div ref={host} className={styles.cm} />;
}
