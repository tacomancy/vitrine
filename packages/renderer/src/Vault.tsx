import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { TreeFile } from "core";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useChosenInView } from "./chosen";
import { FirstSlot, voiceOf } from "./FirstSlot";
import { RefusalLine, useRefusal } from "./refusal-line";
import { markOf } from "./kinds";
import { hashOf, pushRoute, replaceRoute } from "./router";
import { useTRPC } from "./trpc";
import styles from "./Vault.module.css";
import { VaultEditor, type EditorFile, type SavedText } from "./VaultEditor";
import { useVaultStatusLines } from "./VaultStatusLines";

/**
 * The Vault surface (spec #680; `docs/architecture.md` § Vault surface).
 * This slice is its left pane's *files* tab: the vault as a tree, a Kind
 * glyph per file, folders that fold, and *new note*. The editor and the
 * backlinks fill the other two panes in later slices.
 */
export function VaultSurface({ path }: { path: string | undefined }) {
  return (
    <section className={styles.vault} aria-label="Vault">
      <Files open={path} />
      <div className={styles.editor}>
        {path === undefined ? (
          <p className={styles.quiet}>Choose a file from the tree.</p>
        ) : (
          <OpenFile path={path} />
        )}
      </div>
    </section>
  );
}

const edited = (mtime: number) =>
  new Date(mtime).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });

const wordsIn = (text: string) => text.split(/\s+/).filter(Boolean).length;

/**
 * One file in the editor. Opening only reads (`vault.read`): a file that
 * will not read is an Address that did not resolve, and the Inbox says so by
 * name (ADR 0027 decision 7) — replaced, not pushed, so back does not return
 * to it.
 */
function OpenFile({ path }: { path: string }) {
  const trpc = useTRPC();
  const file = useQuery({
    ...trpc.vault.read.queryOptions({ path }),
    retry: false,
    // The previous file's text stays in the one editor until the next
    // arrives, so choosing a file never rebuilds the view.
    placeholderData: keepPreviousData,
  });
  const failure = file.error?.message;
  useEffect(() => {
    if (failure === undefined) return;
    replaceRoute({
      surface: "inbox",
      unresolved: {
        address: hashOf({ surface: "vault", path }),
        reason: failure,
      },
    });
  }, [failure, path]);
  // The file the editor was last handed whole: `file.data` stands in for the
  // next file while it loads, and a save must go to the path its text came
  // from, so the pair is kept as one (state derived during render).
  const [loaded, setLoaded] = useState<EditorFile | null>(null);
  if (
    file.data !== undefined &&
    !file.isPlaceholderData &&
    (loaded?.path !== path || loaded.hash !== file.data.hash)
  ) {
    setLoaded({ path, text: file.data.text, hash: file.data.hash });
  }
  const refusal = useRefusal();
  const replace = useMutation(trpc.vault.replaceFile.mutationOptions());
  const saveFile = async (
    at: string,
    content: string,
    basedOn: string
  ): Promise<SavedText> => {
    refusal.forget();
    try {
      const saved = await replace.mutateAsync({ path: at, content, basedOn });
      if (!saved.written) {
        refusal.say(saved.detail);
        return null;
      }
      // The typing is on disk whatever else happened: a Revision that could
      // not be recorded is said, never a reason to lose or repeat the save.
      if (saved.unrecorded !== undefined) {
        refusal.say(
          `Saved, but its history was not recorded: ${saved.unrecorded}`
        );
      }
      return {
        hash: saved.hash,
        text: saved.content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n"),
      };
    } catch (error) {
      refusal.say(error instanceof Error ? error.message : String(error));
      return null;
    }
  };
  if (file.data === undefined) return null;
  // While the next file loads the editor still holds the last one, so the
  // header, which names `path`, says nothing rather than the old file's facts.
  const loadedNow = file.isPlaceholderData ? null : file.data;
  const words = loadedNow === null ? 0 : wordsIn(loadedNow.text);
  return (
    <>
      <header className={styles.fileHeader}>
        <h1 className={styles.path}>{path}</h1>
        {loadedNow !== null && (
          <span className={styles.meta}>
            edited {edited(loadedNow.mtime)} · {words}{" "}
            {words === 1 ? "word" : "words"}
          </span>
        )}
      </header>
      <RefusalLine refusal={refusal} className={styles.refusal} />
      <VaultEditor file={loaded} save={saveFile} />
    </>
  );
}

/** One visible line of the tree: a folder or a file, at its depth. */
type Row =
  | { type: "folder"; key: string; name: string; depth: number; open: boolean }
  | { type: "file"; key: string; name: string; depth: number; file: TreeFile };

const fileLabel = (path: string) =>
  (path.split("/").at(-1) ?? path).replace(/\.md$/i, "");

type Folder = { folders: Map<string, Folder>; files: TreeFile[] };

function folderOf(files: TreeFile[]): Folder {
  const root: Folder = { folders: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let at = root;
    for (const part of parts.slice(0, -1)) {
      let next = at.folders.get(part);
      if (next === undefined) {
        next = { folders: new Map(), files: [] };
        at.folders.set(part, next);
      }
      at = next;
    }
    at.files.push(file);
  }
  return root;
}

const byName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

/**
 * The rows the tree shows, top to bottom: each folder's folders before its
 * files, both by name, and nothing under a folder that has been folded.
 * Folders are implied by the paths, so an empty folder is not a row — the
 * index holds files, and the tree is a view of it.
 */
function rowsOf(
  folder: Folder,
  folded: ReadonlySet<string>,
  under = "",
  depth = 0
): Row[] {
  const rows: Row[] = [];
  for (const [name, child] of [...folder.folders].sort(([a], [b]) =>
    byName(a, b)
  )) {
    const key = `${under}${name}/`;
    const open = !folded.has(key);
    rows.push({ type: "folder", key, name, depth, open });
    if (open) rows.push(...rowsOf(child, folded, key, depth + 1));
  }
  for (const file of [...folder.files].sort((a, b) =>
    byName(fileLabel(a.path), fileLabel(b.path))
  )) {
    rows.push({
      type: "file",
      key: file.path,
      name: fileLabel(file.path),
      depth,
      file,
    });
  }
  return rows;
}

// For aria-activedescendant; a path is unique but not id-safe, its position
// is, and position is what decides whether a row is in view (ADR 0030).
const rowId = (index: number) => `vault-file-row-${index}`;

function Files({ open }: { open: string | undefined }) {
  const trpc = useTRPC();
  const tree = useQuery(trpc.vault.tree.queryOptions());
  const status = useVaultStatusLines();
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [chosenKey, setChosenKey] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);

  const files = tree.data ?? [];
  const rows = rowsOf(folderOf(files), folded);
  // A choice on a row that has since been folded away, or never made, falls
  // back to the first line rather than to nothing.
  const found = rows.findIndex((row) => row.key === chosenKey);
  const chosen = found === -1 ? 0 : found;
  const activeId = rows.length === 0 ? undefined : rowId(chosen);
  useChosenInView(activeId);

  const toggle = (key: string, open: boolean) =>
    setFolded((was) => {
      const next = new Set(was);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  const act = (row: Row) => {
    setChosenKey(row.key);
    if (row.type === "folder") toggle(row.key, row.open);
    else pushRoute({ surface: "vault", path: row.file.path });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const row = rows[chosen];
    if (row === undefined) return;
    const move = (to: number) => {
      const next = rows[Math.min(Math.max(to, 0), rows.length - 1)];
      if (next !== undefined) setChosenKey(next.key);
    };
    switch (event.key) {
      case "ArrowDown":
        move(chosen + 1);
        break;
      case "ArrowUp":
        move(chosen - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(rows.length - 1);
        break;
      case "ArrowRight":
        if (row.type === "folder" && !row.open) toggle(row.key, false);
        break;
      case "ArrowLeft":
        if (row.type === "folder" && row.open) toggle(row.key, true);
        break;
      case "Enter":
        act(row);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  // Only a vault read in full may say it holds nothing (ADR 0032). A
  // partial tree is still drawn: the files it has are true, and what is
  // missing is the footer channel's to say.
  const voice = voiceOf({
    incomplete: tree.isError,
    answered: tree.data !== undefined,
    read: status.read,
  });

  return (
    <div className={styles.files}>
      <div className={styles.header}>
        <h2 className={styles.tab}>files</h2>
        <button
          type="button"
          className={styles.newNote}
          onClick={() => setNaming(true)}
        >
          New note
        </button>
      </div>
      {naming && <NewNote onDone={() => setNaming(false)} />}
      {rows.length === 0 ? (
        <FirstSlot voice={voice} claim="No notes here yet.">
          Nothing in this vault is a note yet. New note starts one in notes/.
        </FirstSlot>
      ) : (
        <ul
          className={styles.tree}
          role="tree"
          aria-label="Files"
          aria-activedescendant={activeId}
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          {rows.map((row, index) => {
            const kind =
              row.type === "file" ? markOf(row.file.kind ?? "") : undefined;
            const annotations =
              row.type === "file" ? row.file.annotations : undefined;
            const label =
              row.type === "folder"
                ? row.name
                : [
                    row.name,
                    kind?.label,
                    annotations === undefined
                      ? undefined
                      : `${annotations} annotations`,
                  ]
                    .filter((part) => part !== undefined)
                    .join(", ");
            return (
              <li
                key={row.key}
                id={rowId(index)}
                role="treeitem"
                aria-label={label}
                aria-level={row.depth + 1}
                aria-expanded={row.type === "folder" ? row.open : undefined}
                aria-selected={index === chosen}
                aria-current={
                  row.type === "file" && row.file.path === open
                    ? "page"
                    : undefined
                }
                className={styles.row}
                style={{
                  paddingLeft: `calc(var(--space-3) + ${row.depth} * var(--space-4))`,
                }}
                onClick={() => act(row)}
              >
                <span className={styles.glyph} aria-hidden="true">
                  {row.type === "folder" ? (row.open ? "▾" : "▸") : kind?.glyph}
                </span>
                <span className={styles.name}>{row.name}</span>
                {annotations !== undefined && (
                  <span className={styles.count}>{annotations}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {status.hasLines && (
        <footer className={styles.footer}>{status.lines}</footer>
      )}
    </div>
  );
}

/**
 * *New note*: one typed name, written to `notes/` by the core, which refuses
 * a taken name rather than choosing another. The refusal is an alert and
 * the line stays open with what was typed, so the fix is an edit and not a
 * retype (ADR 0033).
 */
function NewNote({ onDone }: { onDone: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const refusal = useRefusal();
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus(), []);
  const create = useMutation(
    trpc.vault.create.mutationOptions({
      onSuccess: ({ path }) => {
        void queryClient.invalidateQueries(trpc.vault.tree.pathFilter());
        onDone();
        pushRoute({ surface: "vault", path });
      },
      onError: (error) => refusal.say(error.message),
    })
  );
  return (
    <div className={styles.naming}>
      <input
        className={styles.nameInput}
        aria-label="Note name"
        placeholder="Name of the note"
        // The line opens because the user asked for it, so it takes the keys.
        ref={field}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onDone();
          else if (event.key === "Enter" && name.trim() !== "") {
            refusal.forget();
            if (!create.isPending) create.mutate({ name });
          }
        }}
      />
      <RefusalLine refusal={refusal} className={styles.refusal} />
    </div>
  );
}
