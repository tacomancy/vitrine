import { useMutation, useQuery } from "@tanstack/react-query";
import type { Vault, Watching } from "core";
import { useEffect } from "react";
import { hashOf, pushRoute, SETTINGS } from "./router";
import styles from "./Settings.module.css";
import { formatDateTime } from "./time";
import { useTRPC } from "./trpc";
import { useVaultStatusLines } from "./VaultStatusLines";

/**
 * Settings (`CONTEXT.md`; ADR 0025; prototype 13): how this vault is
 * arranged, as statements each checkable against the world, and no
 * preference. This slice draws the first section, *Where the vault is*;
 * *Where the PDFs are* is the next ticket's and *What it talks to* is beat
 * 7's, and neither is drawn as a heading before it can be filled — an empty
 * section would be a promise, not a statement.
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
                  onClick={() => reveal.mutate()}
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
 * The *Outside changes* row: a statement, never an alarm. *Not watching* is
 * given no glyph and no warm colour here, because the footer channel is the
 * one place that raises it.
 */
function outsideChanges(watching: Watching, now: Date): string {
  if (!watching.ok) return "not watching";
  const since = new Date(watching.since);
  const today = since.toDateString() === now.toDateString();
  const pad = (n: number) => String(n).padStart(2, "0");
  return today
    ? `seen — watching since ${pad(since.getHours())}:${pad(since.getMinutes())} today`
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
