import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { LinkFile, SearchHit, TreeFile } from "core";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useChosenInView } from "./chosen";
import { FirstSlot, voiceOf } from "./FirstSlot";
import { RefusalLine, useRefusal } from "./refusal-line";
import { classifyLink, refusal as linkRefusal } from "./link-rule";
import { markOf, routeOf } from "./kinds";
import { hashOf, pushRoute, replaceRoute } from "./router";
import { useTRPC } from "./trpc";
import styles from "./Vault.module.css";
import { Marked } from "./VaultMarked";
import { VaultBacklinks } from "./VaultBacklinks";
import {
  VaultEditor,
  type DiskNote,
  type EditorFile,
  type SavedText,
} from "./VaultEditor";
import { useVaultChanged } from "./events";
import { Tags } from "./VaultTags";
import { useVaultStatusLines, type VaultRead } from "./VaultStatusLines";

/**
 * The Vault surface (spec #680; `docs/architecture.md` § Vault surface).
 * The left pane is tabbed: *files* (the vault as a tree, a Kind glyph per
 * file, folders that fold, and *new note*), *tags* (#696) and *search* (full
 * text over note bodies, #697). The editor and the backlinks pane fill the
 * other two panes.
 */
export function VaultSurface({ path }: { path: string | undefined }) {
  // A tag followed from the editor: the tags tab picks its node. `n` makes a
  // second click on the same tag a new request, after the user has moved on.
  const [tag, setTag] = useState<{ text: string; n: number } | null>(null);
  return (
    <section className={styles.vault} aria-label="Vault">
      <LeftPane open={path} seek={tag} />
      <div className={styles.editor}>
        {path === undefined ? (
          <p className={styles.quiet}>Choose a file from the tree.</p>
        ) : (
          <OpenFile
            path={path}
            onTag={(text) => setTag((was) => ({ text, n: (was?.n ?? 0) + 1 }))}
          />
        )}
      </div>
      {path !== undefined && <VaultBacklinks key={path} path={path} />}
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
function OpenFile({
  path,
  onTag,
}: {
  path: string;
  onTag: (tag: string) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const followed = useFollow(path);
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
  // What the disk told the editor about this file (#699). Kept with its path:
  // one editor serves every file, and a note is about one.
  const [note, setNote] = useState<(DiskNote & { path: string }) | null>(null);
  const tell = useCallback(
    (about: Omit<DiskNote, "n" | "at">) =>
      setNote((was) => ({
        ...about,
        path,
        n: (was?.n ?? 0) + 1,
        at: Date.now(),
      })),
    [path]
  );
  useVaultChanged(
    useCallback(
      ({ changed, removed, renamed }) => {
        const moved = renamed.find(({ from }) => from === path);
        if (removed.includes(path)) tell({ kind: "removed" });
        else if (moved !== undefined) tell({ kind: "renamed", to: moved.to });
        else if (changed.includes(path)) tell({ kind: "changed" });
      },
      [path, tell]
    )
  );
  const reread = async () => {
    const copy = await queryClient.fetchQuery({
      ...trpc.vault.read.queryOptions({ path }),
      staleTime: 0,
    });
    return { hash: copy.hash, text: copy.text };
  };
  const saveFile = async (
    at: string,
    content: string,
    basedOn: string
  ): Promise<SavedText> => {
    refusal.forget();
    try {
      const saved = await replace.mutateAsync({ path: at, content, basedOn });
      if (!saved.written) {
        // The file moved under the typing: a line with two actions, not a
        // refusal of something the user did.
        if (saved.reason === "changedOnDisk") tell({ kind: "refused" });
        else refusal.say(saved.detail);
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
      <VaultEditor
        file={loaded}
        save={saveFile}
        disk={note?.path === path ? note : null}
        reread={reread}
        links={{
          resolve: (links) =>
            queryClient.fetchQuery({
              ...trpc.vault.resolveLinks.queryOptions({ from: path, links }),
              staleTime: 0,
            }),
          onWikilink: (link) => void followed.wikilink(link),
          onTag,
          onHref: followed.href,
        }}
      />
      {followed.line}
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

/**
 * What activating a link does (#701; spec #680 stories 41, 42). A resolved
 * wikilink moves the window to the file's own surface, or the Vault for a
 * Note; anything that goes nowhere says so, because a click that did nothing
 * would look like one that worked. A link that names nothing is the user's
 * click refused, so it is an alert (ADR 0033). A link that has candidates —
 * an ambiguous pair, a file whose heading is gone — is a choice to make, not
 * a refusal, and stays polite.
 */
function useFollow(path: string) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const refusal = useRefusal();
  const [choice, setChoice] = useState<{
    link: string;
    why: string;
    candidates: LinkFile[];
  } | null>(null);
  // Said about one file; it does not follow the window to the next.
  const [saidAt, setSaidAt] = useState(path);
  if (saidAt !== path) {
    setSaidAt(path);
    setChoice(null);
    refusal.forget();
  }

  const land = (kind: string | null, to: string) =>
    pushRoute(routeOf(kind, to) ?? { surface: "vault", path: to });

  const wikilink = async (link: string) => {
    refusal.forget();
    setChoice(null);
    // Asked afresh: the picture the editor drew from may be older than the vault.
    let landing;
    try {
      landing = (
        await queryClient.fetchQuery({
          ...trpc.vault.resolveLinks.queryOptions({
            from: path,
            links: [link],
          }),
          staleTime: 0,
        })
      )[link];
    } catch {
      refusal.say(`Could not look up [[${link}]].`);
      return;
    }
    if (landing === undefined) return;
    if (landing.resolution === "resolved" && landing.path !== null) {
      land(landing.kind, landing.path);
    } else if (landing.resolution === "ambiguous") {
      setChoice({
        link,
        why: "is ambiguous: more than one file has that name.",
        candidates: landing.candidates,
      });
    } else if (landing.candidates.length > 0) {
      setChoice({
        link,
        why: "names a file, but not the part of it the link points at.",
        candidates: landing.candidates,
      });
    } else {
      refusal.say(`[[${link}]] has no file in this vault.`);
    }
  };

  const href = (to: string) => {
    refusal.forget();
    setChoice(null);
    const rule = classifyLink(to);
    if (rule.kind === "out") window.open(rule.href, "_blank", "noreferrer");
    // The router reads the hash and nothing else (ADR 0021); an Address
    // typed into note text is followed the way a pasted one is.
    else if (rule.kind === "route") window.location.hash = rule.href;
    else refusal.say(linkRefusal(rule.scheme));
  };

  const line = (
    <>
      <RefusalLine refusal={refusal} className={styles.followLine} />
      {choice !== null && (
        <div role="status" className={styles.followLine}>
          <p>
            [[{choice.link}]] {choice.why}
          </p>
          <ul className={styles.candidates}>
            {choice.candidates.map((c) => (
              <li key={c.path}>
                <button
                  type="button"
                  className={styles.candidate}
                  onClick={() => land(c.kind, c.path)}
                >
                  <span aria-hidden="true">
                    {markOf(c.kind ?? "note")?.glyph}
                  </span>{" "}
                  {c.path}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
  return { wikilink, href, line };
}

const TABS = ["files", "tags", "search"] as const;
type Tab = (typeof TABS)[number];

/**
 * The left pane: one header (the tabs, and *new note* beside *files*), the
 * tab's panel, and the footer channel. Both panels stay mounted and the
 * other is hidden, so a folded folder and a typed query survive a visit to
 * the other tab. The footer is here, once, since it speaks for the vault and
 * not for a tab.
 */
function LeftPane({
  open,
  seek,
}: {
  open: string | undefined;
  seek: { text: string; n: number } | null;
}) {
  const status = useVaultStatusLines();
  const [tab, setTab] = useState<Tab>("files");
  const [naming, setNaming] = useState(false);
  // A tag followed in the editor opens the tags tab.
  const [seen, setSeen] = useState(seek);
  if (seen !== seek) {
    setSeen(seek);
    if (seek !== null) setTab("tags");
  }
  return (
    <div className={styles.files}>
      <div className={styles.header}>
        <div role="tablist" aria-label="Vault views" className={styles.tabs}>
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              id={`vault-tab-${name}`}
              aria-selected={tab === name}
              aria-controls={`vault-panel-${name}`}
              className={styles.tab}
              onClick={() => setTab(name)}
            >
              {name}
            </button>
          ))}
        </div>
        {tab === "files" && (
          <button
            type="button"
            className={styles.newNote}
            onClick={() => setNaming(true)}
          >
            New note
          </button>
        )}
      </div>
      <div
        role="tabpanel"
        id="vault-panel-files"
        aria-labelledby="vault-tab-files"
        className={styles.panel}
        hidden={tab !== "files"}
      >
        <Files
          open={open}
          read={status.read}
          naming={naming}
          onNamed={() => setNaming(false)}
        />
      </div>
      <div
        role="tabpanel"
        id="vault-panel-tags"
        aria-labelledby="vault-tab-tags"
        className={styles.panel}
        hidden={tab !== "tags"}
      >
        <Tags read={status.read} active={tab === "tags"} seek={seek} />
      </div>
      <div
        role="tabpanel"
        id="vault-panel-search"
        aria-labelledby="vault-tab-search"
        className={styles.panel}
        hidden={tab !== "search"}
      >
        <Search read={status.read} active={tab === "search"} />
      </div>
      {status.hasLines && (
        <footer className={styles.footer}>{status.lines}</footer>
      )}
    </div>
  );
}

function Files({
  open,
  read,
  naming,
  onNamed,
}: {
  open: string | undefined;
  read: VaultRead;
  naming: boolean;
  onNamed: () => void;
}) {
  const trpc = useTRPC();
  const tree = useQuery(trpc.vault.tree.queryOptions());
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [chosenKey, setChosenKey] = useState<string | null>(null);
  const [attaching, setAttaching] = useState<string | null>(null);

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
    read,
  });

  return (
    <>
      {naming && <NewNote onDone={onNamed} />}
      {attaching !== null && (
        <AttachPdf stub={attaching} onDone={() => setAttaching(null)} />
      )}
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
                {row.type === "file" && row.file.kind === "source" && (
                  <button
                    type="button"
                    className={styles.command}
                    onClick={(event) => {
                      event.stopPropagation();
                      pushRoute({ surface: "source", path: row.file.path });
                    }}
                  >
                    open in reader
                  </button>
                )}
                {row.type === "file" && row.file.kind === "source-stub" && (
                  <button
                    type="button"
                    className={styles.command}
                    onClick={(event) => {
                      event.stopPropagation();
                      setAttaching(row.file.path);
                    }}
                  >
                    attach a PDF
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/**
 * A stub's *attach a PDF* (#702): the Reader beat's own write, the one the
 * Loose Ends stub row calls, so a stub becomes a Source here by exactly the
 * act it does there — the core attaches and ingests, this only chooses. The
 * list is the PDFs no Source names; a refusal is an alert and leaves the
 * choice open to try another (ADR 0033).
 */
function AttachPdf({ stub, onDone }: { stub: string; onDone: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [attached, setAttached] = useState<string | null>(null);
  const refusal = useRefusal();
  const waiting = useQuery(trpc.sources.unnamedPdfs.queryOptions());
  const attach = useMutation(
    trpc.sources.attachToStub.mutationOptions({
      onSuccess: (_reply, { pdf }) => {
        setAttached(pdf);
        void queryClient.invalidateQueries(trpc.vault.tree.pathFilter());
      },
      onError: (error) => refusal.say(error.message),
    })
  );
  const leaf = (path: string) => path.replace(/^.*\//, "");
  return (
    <div
      className={styles.naming}
      role="group"
      aria-label={`Attach a PDF to ${leaf(stub)}`}
    >
      {attached !== null ? (
        <p role="status" className={styles.note}>
          Attached {leaf(attached)} — {leaf(stub)} is a Source now.
        </p>
      ) : (
        <ul className={styles.pdfs}>
          {(waiting.data ?? []).map((pdf) => (
            <li key={pdf}>
              <button
                type="button"
                className={styles.command}
                onClick={() => {
                  refusal.forget();
                  if (!attach.isPending) attach.mutate({ pdf, stub });
                }}
              >
                {leaf(pdf)}
              </button>
            </li>
          ))}
          {waiting.data?.length === 0 && (
            <li>No PDF in the folder is waiting for a Source.</li>
          )}
        </ul>
      )}
      <RefusalLine refusal={refusal} className={styles.refusal} />
      <button type="button" className={styles.command} onClick={onDone}>
        {attached === null ? "cancel" : "done"}
      </button>
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

const hitId = (index: number) => `vault-hit-${index}`;

/**
 * The *search* tab (#697): full text over note bodies. The query goes to the
 * core as typed; the core answers from its index with no file read, so there
 * is no spinner to draw and each keystroke is a new question. The input holds
 * the focus and the arrows move a choice that the list publishes as its
 * `aria-activedescendant`, as the Global command does (ADR 0030).
 */
function Search({ read, active }: { read: VaultRead; active: boolean }) {
  const trpc = useTRPC();
  const [text, setText] = useState("");
  const [choice, setChoice] = useState({ text: "", at: 0 });
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (active) field.current?.focus();
  }, [active]);
  const query = text.trim();
  const found = useQuery({
    ...trpc.vault.search.queryOptions({ query }),
    enabled: query !== "",
    // The last answer stays while the next arrives, so typing does not
    // flash the list away between keystrokes.
    placeholderData: keepPreviousData,
  });
  const hits = query === "" ? [] : (found.data ?? []);
  // A choice belongs to the text it was made under: a new query starts at the top.
  const chosen = Math.min(
    choice.text === text ? choice.at : 0,
    Math.max(hits.length - 1, 0)
  );
  const activeId = hits.length === 0 ? undefined : hitId(chosen);
  useChosenInView(activeId);

  const open = (hit: SearchHit) =>
    pushRoute({ surface: "vault", path: hit.path });
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const move = (to: number) => {
      setChoice({
        text,
        at: Math.min(Math.max(to, 0), hits.length - 1),
      });
      event.preventDefault();
    };
    if (event.key === "ArrowDown") move(chosen + 1);
    else if (event.key === "ArrowUp") move(chosen - 1);
    else if (event.key === "Enter" && hits[chosen] !== undefined) {
      open(hits[chosen]);
      event.preventDefault();
    }
  };

  const answered = found.data !== undefined && !found.isPlaceholderData;
  return (
    <>
      <div className={styles.naming}>
        <input
          ref={field}
          type="search"
          role="searchbox"
          className={styles.nameInput}
          aria-label="Search the vault"
          aria-controls="vault-hits"
          aria-activedescendant={activeId}
          placeholder="Search the notes"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      {hits.length > 0 && (
        <ul
          id="vault-hits"
          className={styles.hits}
          role="listbox"
          aria-label="Search results"
        >
          {hits.map((hit, index) => {
            const kind = markOf(hit.kind ?? "");
            const name = fileLabel(hit.path);
            return (
              <li
                key={hit.path}
                id={hitId(index)}
                role="option"
                aria-selected={index === chosen}
                aria-label={[name, kind?.label, hit.path]
                  .filter((part) => part !== undefined)
                  .join(", ")}
                className={styles.hit}
                onClick={() => open(hit)}
              >
                <span className={styles.hitName}>
                  <span className={styles.glyph} aria-hidden="true">
                    {kind?.glyph}
                  </span>
                  <span className={styles.name}>{name}</span>
                </span>
                <span className={styles.line}>
                  <Marked line={hit.line} marks={hit.marks} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {query !== "" && hits.length === 0 && (
        <FirstSlot
          voice={voiceOf({
            incomplete: found.isError,
            answered,
            read,
          })}
          claim={`Nothing matches ${query}.`}
        />
      )}
    </>
  );
}
