import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";
import styles from "./Vault.module.css";

/**
 * One `EditorView`, for the life of the surface (`docs/architecture.md`
 * § Vault surface, *Editor*). It is created once and the document is pushed
 * in with a single whole-document `dispatch`, and only when the *file*
 * changes: React never re-renders per keystroke and never owns the text.
 *
 * Read-only until the save ticket. The text is the editor's LF text; the
 * file's CRLF and BOM are the core's to restore around a save, so nothing
 * here needs `lineSeparator` yet.
 */
export function VaultEditor({ file, text }: { file: string; text: string }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);

  useEffect(() => {
    const parent = host.current;
    if (parent === null) return;
    const created = new EditorView({
      parent,
      state: EditorState.create({
        doc: text,
        extensions: [
          // `editable` is what makes the content non-editable in the DOM;
          // `readOnly` is what stops a command the keymap would run.
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.contentAttributes.of({
            "aria-label": "Editor",
            "aria-readonly": "true",
            role: "textbox",
            "aria-multiline": "true",
          }),
          EditorView.lineWrapping,
        ],
      }),
    });
    view.current = created;
    return () => {
      created.destroy();
      view.current = null;
    };
    // The view is made once; the effect below is what hands it a file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const current = view.current;
    if (current === null || current.state.doc.toString() === text) return;
    current.dispatch({
      changes: { from: 0, to: current.state.doc.length, insert: text },
    });
    // `file` is a dependency so two files with the same text still reset the
    // scroll and selection the way a different file would.
  }, [file, text]);

  return <div ref={host} className={styles.cm} />;
}
