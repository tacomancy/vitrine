import { syntaxHighlighting } from "@codemirror/language";
import {
  history,
  historyKeymap,
  insertNewlineAndIndent,
  isolateHistory,
} from "@codemirror/commands";
import {
  Annotation,
  ChangeSet,
  EditorSelection,
  EditorState,
  Transaction,
  type ChangeSpec,
} from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import styles from "./Vault.module.css";
import { WarningLine } from "./VaultStatusLines";
import { vaultMarkdown } from "./vault-grammar";
import { vaultHighlight } from "./vault-highlight";
import { forgetResolutions, vaultLinks, type LinkHooks } from "./vault-links";
import { vaultEmbeds } from "./vault-embeds";
import { livePreview, restPreview } from "./vault-live-preview";

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

/**
 * What reached the editor about its open file from outside (#699). `n` makes a
 * second note of the same kind a new one. `refused` is `replaceFile`'s hash
 * mismatch; the rest are a `vaultChanged` naming the open path.
 */
export type DiskNote = {
  n: number;
  kind: "changed" | "refused" | "removed" | "renamed";
  /** Where a renamed file went. */
  to?: string;
  /** When it was heard, which is what the line's age counts from. */
  at: number;
};

/** The disk's side of the file, read afresh: LF text, and the hash a save is `basedOn`. */
export type DiskCopy = { hash: string; text: string };

/** The line the editor shows while the disk and its document disagree. */
type DiskLine = {
  kind: DiskNote["kind"];
  to?: string;
  at: number;
  /** An action could not read the disk: said, so the buttons are not dead. */
  failed?: boolean;
};

const agoOf = (since: number, now: number) => {
  const minutes = Math.floor((now - since) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ago`;
};

const wording: Record<DiskNote["kind"], string> = {
  changed: "changed on disk",
  refused: "changed on disk",
  removed: "removed on disk",
  renamed: "renamed on disk",
};

/** Marks a transaction that is not the user's typing: a file pushed in, a Revision taken back. */
const fromDisk = Annotation.define<true>();
// Not the user's typing, so not the user's to undo: ⌘Z must never take back
// what the disk said.
const notUserEdit = [fromDisk.of(true), Transaction.addToHistory.of(false)];

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
 * Save (#693, #698): on a short idle, on ⌘S, on blur, when the window is
 * closing, and before another file replaces the document, each `basedOn` the
 * hash of the text last read from or written to disk. The text is the editor's LF text; the file's CRLF and
 * BOM are the core's to restore around a save, so nothing here needs
 * `lineSeparator` yet. There is no undo history until the editor's
 * extensions land.
 *
 * Changed on disk (#699): the file moved under unsaved typing, or a save was
 * refused for its hash, or the file went. One non-modal line says so with
 * *keep mine* and *take the disk copy*; saving is suspended while it shows
 * (a save would only be refused again, or overwrite what the user has not
 * seen), and typing goes on. A clean editor has nothing to lose, so it takes
 * the new text in silently, as a splice so the cursor and scroll stay.
 */
export function VaultEditor({
  file,
  save,
  links,
  disk,
  reread,
  attach,
  stranded,
}: {
  file: EditorFile | null;
  save: (path: string, content: string, basedOn: string) => Promise<SavedText>;
  /**
   * Copy dropped files in, in order (#754): per file the name it was stored
   * under, or null once the caller has said why it was not. The editor writes
   * an embed only for a name, so a refused or failed copy leaves the note as
   * it was.
   */
  attach: (sources: string[]) => Promise<(string | null)[]>;
  /** Files were copied but their embeds had no note to go into: said, never dropped quietly. */
  stranded: (names: string[]) => void;
  links: LinkHooks;
  disk: DiskNote | null;
  reread: () => Promise<DiskCopy>;
}) {
  // The extension reads the latest hooks through this, so the view is still
  // made once and a render never rebuilds it.
  const hooks = useRef(links);
  const attachRef = useRef(attach);
  const strandedRef = useRef(stranded);
  useEffect(() => {
    hooks.current = links;
    attachRef.current = attach;
    strandedRef.current = stranded;
  });
  // Where each drop in flight will land. A copy takes time, and the note may
  // be typed in meanwhile, so the position is carried through every change
  // rather than read when the copy comes back.
  const drops = useRef(new Set<{ pos: number }>());
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
  const flushRef = useRef<(leaving?: boolean) => Promise<void>>(() =>
    Promise.resolve()
  );
  const [line, setLine] = useState<DiskLine | null>(null);
  // Read by the save paths, which are closures made once: while true, an
  // idle, blur or ⌘S save is held back. Leaving the file still saves, since
  // the document is about to go and the refusal is then said.
  const suspended = useRef(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (line === null) return;
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(tick);
  }, [line]);
  useEffect(() => {
    suspended.current = line !== null;
  }, [line]);
  const show = (next: DiskLine | null) => {
    suspended.current = next !== null;
    clearTimeout(timer.current);
    setLine(next);
  };

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useEffect(() => {
    flushRef.current = async (leaving = false) => {
      clearTimeout(timer.current);
      const current = view.current;
      const target = held.current;
      if (current === null || target === null || !dirty.current) return;
      if (suspended.current && !leaving) return;
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
          annotations: notUserEdit,
        });
      }
      dirty.current = !run.typed.empty;
      if (dirty.current && run.again) void flushRef.current();
    };
  });

  /**
   * Copy each dropped file in turn, then write their embeds in one
   * transaction at the drop (spec #751): the order dropped, nothing written
   * for a file that was not copied, and a single undo for the lot. The copies
   * stay if the embeds are undone, since nothing the app copies in is deleted
   * (ADR 0035 decision 2). If another file has replaced the document while
   * the copies were out, the embeds have no place to go: they are not
   * written and the copies are reported as `stranded`.
   */
  const embedAll = async (
    target: EditorView,
    dropped: File[],
    drop: { pos: number },
    from: string | undefined
  ) => {
    try {
      const names = (
        await attachRef.current(dropped.map((f) => window.vitrine.pathOf(f)))
      ).filter((name) => name !== null);
      if (names.length === 0) return;
      if (view.current !== target || held.current?.path !== from) {
        strandedRef.current(names);
        return;
      }
      // The live preview draws an embed only when it is a line of its own.
      const line = target.state.doc.lineAt(drop.pos);
      const lead = drop.pos > line.from ? "\n" : "";
      const trail = drop.pos < line.to ? "\n" : "";
      const insert = lead + names.map((n) => `![[${n}]]`).join("\n") + trail;
      target.dispatch({
        changes: { from: drop.pos, insert },
        selection: EditorSelection.cursor(drop.pos + insert.length),
        userEvent: "input.drop",
        annotations: isolateHistory.of("full"),
      });
    } finally {
      drops.current.delete(drop);
    }
  };

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
          // The parse is of the editor's LF text, so a CRLF file needs no
          // care here; the tags and links it colours are the ones the index
          // counts (`vault-grammar.parity.test.ts`).
          vaultMarkdown(),
          syntaxHighlighting(vaultHighlight),
          vaultLinks(() => hooks.current),
          livePreview(),
          vaultEmbeds(),
          history(),
          keymap.of([
            ...historyKeymap,
            // Not the whole default keymap: the browser already owns caret
            // movement and deletion, but a contenteditable CodeMirror owns
            // Enter, and with no binding it types nothing (#777).
            {
              key: "Enter",
              shift: insertNewlineAndIndent,
              run: insertNewlineAndIndent,
            },
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
            for (const drop of drops.current) {
              drop.pos = update.changes.mapPos(drop.pos, 1);
            }
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
            dragover: (event) => {
              if (event.dataTransfer?.types.includes("Files") !== true) {
                return false;
              }
              event.preventDefault();
              return true;
            },
            drop: (event, target) => {
              const dropped = Array.from(event.dataTransfer?.files ?? []);
              // Dragged text and links are the editor's own; only files are ours.
              if (dropped.length === 0) return false;
              event.preventDefault();
              const drop = {
                pos:
                  target.posAtCoords({ x: event.clientX, y: event.clientY }) ??
                  target.state.selection.main.head,
              };
              drops.current.add(drop);
              void embedAll(target, dropped, drop, held.current?.path);
              return true;
            },
          }),
        ],
      }),
    });
    view.current = created;
    // Closing the window is no blur and unmounts nothing React gets to run:
    // the page is simply gone, so the save is sent from the event that says
    // it is going. `beforeunload` is Electron's close; `pagehide` the rest.
    const leaving = () => void flushRef.current();
    window.addEventListener("beforeunload", leaving);
    window.addEventListener("pagehide", leaving);
    return () => {
      window.removeEventListener("beforeunload", leaving);
      window.removeEventListener("pagehide", leaving);
      // Typing the idle timer had not yet saved still goes out; the view is
      // read before it is destroyed.
      void flushRef.current(true);
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
    if (switching) void flushRef.current(true);
    held.current = { path, hash };
    dirty.current = false;
    clearTimeout(timer.current);
    if (switching) show(null);
    const before = current.state.doc.toString();
    // The same file arriving anew is spliced in, so the cursor and scroll
    // map past it; a different file replaces the document whole.
    const changes =
      before === text
        ? []
        : switching
          ? [{ from: 0, to: current.state.doc.length, insert: text }]
          : [spliceBetween(before, text)];
    // A new file forgets what links the last one resolved.
    if (changes.length === 0 && !switching) return;
    current.dispatch({
      changes,
      effects: switching
        ? [forgetResolutions.of(null), restPreview.of(null)]
        : forgetResolutions.of(null),
      annotations: notUserEdit,
    });
  }, [path, text, hash]);

  // What reached the editor from outside. A change under clean text needs
  // no line: the re-read it asks for is what the effect above takes in.
  const [heard, setHeard] = useState(0);
  if (disk !== null && disk.n !== heard) {
    setHeard(disk.n);
    if (disk.kind !== "changed") {
      setLine({
        kind: disk.kind,
        ...(disk.to === undefined ? {} : { to: disk.to }),
        at: disk.at,
      });
    }
  }
  const changedAt = disk?.kind === "changed" ? disk.at : undefined;
  const noteN = disk?.n;
  useEffect(() => {
    if (changedAt === undefined) return;
    let stale = false;
    // A read that fails leaves the editor as it was; the surface's own
    // error handling says why the file cannot be read.
    void reread().then(
      (copy) => {
        if (stale) return;
        // Nothing of the user's is at stake — the disk is what the editor holds
        // (its own echo, or a file that came back as it was) or there is no
        // typing — so any line from before is retracted, a removed file that
        // reappeared included.
        if (held.current?.hash === copy.hash || !dirty.current) show(null);
        else show({ kind: "changed", at: changedAt });
      },
      () => {}
    );
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one note, one reaction
  }, [noteN]);

  const unread = () =>
    setLine((was) => (was === null ? null : { ...was, failed: true }));
  const keepMine = async () => {
    const copy = await reread().catch(() => null);
    if (copy === null) return unread();
    if (held.current !== null)
      held.current = { ...held.current, hash: copy.hash };
    show(null);
    await flushRef.current();
  };
  const takeDisk = async () => {
    const copy = await reread().catch(() => null);
    if (copy === null) return unread();
    const current = view.current;
    if (current === null || held.current === null) return;
    held.current = { ...held.current, hash: copy.hash };
    dirty.current = false;
    show(null);
    current.dispatch({
      changes: spliceBetween(current.state.doc.toString(), copy.text),
      annotations: notUserEdit,
    });
  };

  return (
    <>
      {line !== null && (
        <WarningLine label={wording[line.kind]}>
          {line.kind === "renamed" && line.to !== undefined && (
            <>to {line.to} · </>
          )}
          {agoOf(line.at, Math.max(now, line.at))}
          {line.failed === true && <> · could not read the file</>}
          {(line.kind === "changed" || line.kind === "refused") && (
            <>
              {" "}
              ·{" "}
              <button type="button" onClick={() => void keepMine()}>
                keep mine
              </button>{" "}
              <button type="button" onClick={() => void takeDisk()}>
                take the disk copy
              </button>
            </>
          )}
        </WarningLine>
      )}
      <div ref={host} className={styles.cm} />
    </>
  );
}
