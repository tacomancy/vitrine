import { useMutation, useQuery } from "@tanstack/react-query";
import type { PdfFolder, Vault, Watching } from "core";
import { useEffect } from "react";
import { voiceOf } from "./FirstSlot";
import { hashOf, pushRoute, SETTINGS } from "./router";
import { localTime } from "./rows";
import styles from "./Settings.module.css";
import { formatDateTime } from "./time";
import { useTRPC } from "./trpc";
import { useVaultStatusLines, type VaultRead } from "./VaultStatusLines";

/**
 * Settings (`CONTEXT.md`; ADR 0025; prototype 13): how this vault is
 * arranged, as statements each checkable against the world, and no
 * preference. Two of its three sections: *What it talks to* is beat 7's,
 * and is not drawn as a heading before it can be filled — an empty section
 * would be a promise, not a statement.
 */
export function Settings({ vault }: { vault: Vault }) {
  const trpc = useTRPC();
  const status = useQuery(trpc.vault.status.queryOptions());
  const reveal = useMutation(trpc.vault.reveal.mutationOptions());
  const footer = useVaultStatusLines();

  return (
    <section className={styles.settings} aria-labelledby="settings-title">
      <div className={styles.header}>
        <h1 id="settings-title" className={styles.title}>
          Settings
        </h1>
        <span className={styles.subtitle}>how {vault.name} is arranged</span>
      </div>
      <div className={styles.scroll}>
        <section
          className={styles.section}
          aria-labelledby="settings-where-the-vault-is"
        >
          <h2 id="settings-where-the-vault-is" className={styles.heading}>
            Where the vault is
          </h2>
          <dl className={styles.rows}>
            <div className={styles.row}>
              <dt className={styles.label}>Folder</dt>
              <dd className={styles.value}>
                <span className={styles.fact}>{vault.path}</span>
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => reveal.mutate({ folder: "vault" })}
                >
                  Reveal in Finder
                </button>
              </dd>
            </div>
            <div className={styles.row}>
              <dt className={styles.label}>App state</dt>
              {/* Not *writes for itself*, as the prototype has it: the app
                  also writes Artifacts into the vault (ADR 0035;
                  `docs/architecture.md` § Settings). */}
              <dd className={styles.value}>
                {vault.name}/.vitrine — the one folder the app keeps for itself
              </dd>
            </div>
            <div className={styles.row}>
              <dt className={styles.label}>Outside changes</dt>
              <dd className={styles.value}>
                {status.isError
                  ? "not known"
                  : status.data === undefined
                    ? "not yet"
                    : outsideChanges(status.data.watching, new Date())}
              </dd>
            </div>
          </dl>
        </section>
        <WhereThePdfsAre
          vault={vault}
          read={footer.read}
          onReveal={() => reveal.mutate({ folder: "pdfs" })}
        />
      </div>
      {/* The footer channel, as on every surface. *Not watching* is sounded
          here and only stated above: two alarms for one fault are two
          places that can drift apart (ADR 0025 decision 7). A refused
          reveal is not the vault's state, so it has no line of its own. */}
      {footer.hasLines && (
        <footer className={styles.footer}>{footer.lines}</footer>
      )}
    </section>
  );
}

/**
 * *Where the PDFs are* (#378; `docs/architecture.md` § Settings): the
 * arrangement the researcher made in Finder, stated and never set. Its one
 * control is *Reveal in Finder*; there is nothing here, or in the core, that
 * makes, re-points or removes the link or copies a PDF (KEEP-11, ADR 0025
 * decision 6).
 */
function WhereThePdfsAre({
  vault,
  read,
  onReveal,
}: {
  vault: Vault;
  read: VaultRead;
  onReveal: () => void;
}) {
  const trpc = useTRPC();
  const query = useQuery(trpc.vault.pdfFolder.queryOptions());
  const folder = query.data;
  // The facts are a stat of the folder, but *Nothing has arrived yet* is a
  // claim the vault's read warrants, so while the vault is being read the
  // rows that could make it say *not yet* rather than a count the watcher
  // is about to overtake.
  const pending = query.isPending || read === "reading";
  const state: Read = query.isError
    ? "failed"
    : pending || folder === undefined
      ? "pending"
      : folder;

  return (
    <section className={styles.section} aria-labelledby="settings-pdfs">
      <h2 id="settings-pdfs" className={styles.heading}>
        Where the PDFs are
      </h2>
      <dl className={styles.rows}>
        <div className={styles.row}>
          <dt className={styles.label}>Folder</dt>
          <dd className={styles.value}>
            <span className={styles.fact}>
              {vault.name}/sources/pdf
              {folder?.exists === false && (
                <span className={styles.sentence}>
                  This vault has no sources/pdf yet. Papers arrive through it
                  once it is made in Finder: a plain folder, or a link to an
                  iCloud Drive or Dropbox folder.
                </span>
              )}
              {folder?.exists === true && folder.link !== null && (
                <span className={styles.note}>
                  a link, pointing at {folder.link}
                </span>
              )}
            </span>
            {folder?.exists === true && (
              <button
                type="button"
                className={styles.action}
                onClick={onReveal}
              >
                Reveal in Finder
              </button>
            )}
          </dd>
        </div>
        {folder?.exists !== false && (
          <>
            <div className={styles.row}>
              <dt className={styles.label}>Resolves to</dt>
              <dd className={styles.value}>{resolvesTo(state)}</dd>
            </div>
            <div className={styles.row}>
              <dt className={styles.label}>Holds</dt>
              <dd className={styles.value}>
                <Holds state={state} read={read} />
              </dd>
            </div>
            {!pending && folder?.exists === true && folder.lastArrived && (
              <div className={styles.row}>
                <dt className={styles.label}>Last arrived</dt>
                <dd className={styles.value}>
                  <span className={styles.fact}>
                    {formatDateTime(new Date(folder.lastArrived.at))}
                    <span className={styles.note}>
                      {folder.lastArrived.name}
                    </span>
                  </span>
                </dd>
              </div>
            )}
          </>
        )}
      </dl>
      <p className={styles.paragraph}>
        The app never moves a file here and has no sync setting: whatever syncs
        your files syncs this folder. Change the arrangement in Finder.
      </p>
    </section>
  );
}

/** The PDF folder as far as the section has it: not yet answered, a read that failed, or the facts. */
type Read = "pending" | "failed" | PdfFolder;

function resolvesTo(state: Read): string {
  if (state === "pending") return "not yet";
  if (state === "failed" || !state.exists) return "not known";
  const folder = state;
  if (folder.resolves === null) return "not known";
  if (folder.link === null) return "itself — a plain folder in the vault";
  return folder.resolves.known ?? folder.resolves.path;
}

/**
 * The *Holds* row. A count is what is in a folder, not work left (spec #363
 * story 38), so it is stated plainly. An empty folder is the one line here
 * that asserts *nothing is there*, so it is a claim with its Warrant (ADR
 * 0032), and only a vault read in full and watched can warrant it. Anything
 * short of that is a plain fragment: *not watching* is sounded in the footer
 * channel, and a glyph here would be a second alarm (story 11).
 */
function Holds({ state, read }: { state: Read; read: VaultRead }) {
  if (state === "pending") return <>not yet</>;
  if (state === "failed" || !state.exists || state.holds === null)
    return <>not known</>;
  const { count, bytes } = state.holds;
  if (count > 0)
    return (
      <>
        {count} {count === 1 ? "PDF" : "PDFs"} · {formatSize(bytes)}
      </>
    );
  const voice = voiceOf({ incomplete: false, answered: true, read });
  if (voice === "claim")
    return (
      <>
        <span className={styles.claim}>Nothing has arrived yet.</span>
        <span className={styles.warrant}>read in full · watching</span>
      </>
    );
  return <>{voice === "wrong" ? "not known" : "not yet"}</>;
}

/** Decimal units, as Finder counts them, to three figures: `1.84 GB`. */
function formatSize(bytes: number): string {
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const figure = unit === 0 ? value : Number(value.toPrecision(3));
  return `${figure} ${units[unit]}`;
}

/**
 * The *Outside changes* row: a statement, never an alarm. *Not watching* is
 * given no glyph and no warm colour here, because the footer channel is the
 * one place that raises it.
 */
function outsideChanges(watching: Watching, now: Date): string {
  if (!watching.ok) return "not watching";
  const since = new Date(watching.since);
  return since.toDateString() === now.toDateString()
    ? `seen — watching since ${localTime(watching.since)} today`
    : `seen — watching since ${formatDateTime(since)}`;
}

/**
 * ⌘, and App ▸ Settings… (ADR 0025 decision 5). A renderer key handler as
 * well as the menu, so the chord works in a client with no menu bar, as ⌘K
 * does. Mounted only where a vault is, which is what keeps First run to its
 * one action: nothing is listening there for either.
 *
 * In the shell one keypress can reach both the menu's accelerator and this
 * handler, so opening Settings while on it does nothing, rather than
 * stacking a second history entry that back would have to step through.
 */
export function SettingsChord(): null {
  useEffect(() => {
    const open = () => {
      if (window.location.hash !== hashOf(SETTINGS)) pushRoute(SETTINGS);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && event.key === ",") {
        event.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("vitrine:settings", open);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("vitrine:settings", open);
    };
  }, []);
  return null;
}
