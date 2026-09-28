import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  ExperimentFacet,
  ExperimentSort,
  ExperimentStatus,
  ListedExperiment,
} from "core";
import { useRef, useState, type KeyboardEvent } from "react";
import { formatAge } from "./age";
import { AttachEvidence } from "./AttachEvidence";
import { useChosenInView } from "./chosen";
import styles from "./Experiments.module.css";
import { ArtifactCard } from "./ExperimentArtifacts";
import { FirstSlot, voiceOf } from "./FirstSlot";
import { useTRPC } from "./trpc";
import { TypedLine } from "./TypedLine";
import { useVaultStatusLines, WarningLine } from "./VaultStatusLines";

/** Which runs the list shows: a facet, and a status when the facet is `status` (none is every run). */
type View = { facet: ExperimentFacet; status?: ExperimentStatus };

const INBOX_VIEWS: { label: string; view: View }[] = [
  { label: "inbox", view: { facet: "inbox" } },
  { label: "not yet interpreted", view: { facet: "not-yet-interpreted" } },
  { label: "read, unattached", view: { facet: "read-unattached" } },
];

const STATUS_VIEWS: { label: string; view: View }[] = [
  { label: "every run", view: { facet: "status" } },
  ...(["planned", "running", "complete", "abandoned"] as const).map(
    (status) => ({ label: status, view: { facet: "status" as const, status } })
  ),
];

const SORTS: { label: string; sort: ExperimentSort }[] = [
  { label: "newest", sort: "newest" },
  { label: "oldest", sort: "oldest" },
  { label: "most artifacts", sort: "most-artifacts" },
  { label: "shuffle", sort: "shuffle" },
];

/**
 * What an empty view claims, when it may claim anything (ADR 0032): a
 * sentence about the runs that are there, never a cheerful zero.
 */
function claimOf(view: View, runs: number, project: string | undefined) {
  const where = project === undefined ? "" : ` in ${project}`;
  if (runs === 0) return "No experiments have been recorded in this vault.";
  switch (view.facet) {
    case "inbox":
      return `No complete run is unread or unattached${where}.`;
    case "not-yet-interpreted":
      return `Every complete run${where} has its observations written.`;
    case "read-unattached":
      return `No complete run${where} with observations stands unattached.`;
    case "status":
      return view.status === undefined
        ? `No run is recorded${where}.`
        : `No run${where} is ${view.status}.`;
  }
}

const sameView = (a: View, b: View) =>
  a.facet === b.facet && a.status === b.status;

/**
 * The Experiment surface, at `#/experiments` (#372; brief § Experiment
 * surface; spec #362 stories 56–67; prototype 05's third panel). It opens
 * on the Experiment Inbox — the complete runs not yet written up, or not
 * yet attached to a Criterion — which the core derives on every read, so
 * nothing here can clear a run: it leaves by being written up and
 * attached, or abandoned (story 66). The Inbox's two halves are views of
 * their own, as is every run by status, and a project narrows any of them.
 *
 * The Question Inbox's rule holds (HOLD-5, HOLD-6): the one number in the
 * chrome is how many runs exist, the views carry no counts, and nothing
 * turns a colour with age. The prototype's per-view counts are dropped for
 * that reason — *52 not yet interpreted* is a tally of undone work.
 *
 * `O`, `E` and `D` act on the chosen run: its page with the keyboard in
 * Observations, *attach as evidence* (#367's list), and `status:
 * abandoned`. The line that makes a run by name stays at the list's head.
 */
export function Experiments({
  onMade,
  onObserve,
}: {
  /** Where the made run's page opens — the window's, since it moves the Address. */
  onMade: (path: string) => void;
  /** `O`: the run's page, with the keyboard in Observations. */
  onObserve: (path: string) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>({ facet: "inbox" });
  const [project, setProject] = useState<string | undefined>(undefined);
  const [sort, setSort] = useState<ExperimentSort>("newest");
  // A shuffle holds still until it is asked for again: the core orders by
  // this seed, so a re-read after a write keeps the list where it was.
  const [seed, setSeed] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [attaching, setAttaching] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{
    path: string;
    message: string;
  } | null>(null);
  if (refusal !== null && refusal.path !== selected) setRefusal(null);
  const listRef = useRef<HTMLUListElement>(null);
  const vaultStatus = useVaultStatusLines();

  const listing = useQuery({
    ...trpc.experiments.inbox.queryOptions({
      ...view,
      ...(project === undefined ? {} : { project }),
      sort,
      ...(sort === "shuffle" ? { seed } : {}),
    }),
    placeholderData: keepPreviousData,
  });
  const failed = listing.isError;
  const rows = listing.data?.experiments ?? [];
  const runs = listing.data?.runs ?? 0;
  const projects = listing.data?.projects ?? [];
  const unreadable = listing.data?.unreadable ?? [];
  // A project whose last `repo:` line went away takes its facet with it;
  // the narrowing goes too, or the list would stay filtered to nothing
  // with no control left to lift it.
  if (
    project !== undefined &&
    listing.data !== undefined &&
    !projects.includes(project)
  ) {
    setProject(undefined);
  }
  const selectedRow = rows.find((row) => row.path === selected) ?? null;
  const selectedRowId =
    selectedRow === null ? undefined : rowId(rows.indexOf(selectedRow));
  useChosenInView(selectedRowId);
  const now = new Date();

  // `D`: the one write this surface makes of its own, `status: abandoned`,
  // based on the read the row was listed from. A refusal is a line on the
  // row, never a dialog.
  const abandon = useMutation(
    trpc.experiments.setStatus.mutationOptions({
      onSuccess: (result, { path }) => {
        if (!result.written) {
          setRefusal({
            path,
            message: `could not abandon it: ${result.detail}`,
          });
          return;
        }
        void queryClient.invalidateQueries(trpc.experiments.inbox.pathFilter());
        void queryClient.invalidateQueries(
          trpc.experiments.page.queryFilter({ path })
        );
      },
      onError: (error, { path }) =>
        setRefusal({ path, message: `could not abandon it: ${error.message}` }),
    })
  );

  const act: Act = {
    observe: (row: ListedExperiment) => onObserve(row.path),
    attach: (row: ListedExperiment) => setAttaching(row.path),
    abandon: (row: ListedExperiment) => {
      // Already abandoned: nothing to do, as the pane offers nothing.
      if (abandon.isPending || row.status === "abandoned") return;
      setRefusal(null);
      abandon.mutate({
        path: row.path,
        status: "abandoned",
        basedOn: row.hash,
      });
    },
  };

  // j/k and the arrows move the choice; ↵ takes the first row when nothing
  // is chosen; O, E and D act on the chosen run, in either case, since the
  // prototype draws them capitalised and the Question Inbox's keys are not.
  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (rows.length === 0) return;
    const index = rows.findIndex((row) => row.path === selected);
    let next: number | null = null;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const action = ({ o: act.observe, e: act.attach, d: act.abandon } as const)[
      key as "o" | "e" | "d"
    ];
    if (action !== undefined) {
      if (selectedRow === null) return;
      event.preventDefault();
      action(selectedRow);
      return;
    }
    switch (key) {
      case "j":
      case "ArrowDown":
        next = Math.min(index + 1, rows.length - 1);
        break;
      case "k":
      case "ArrowUp":
        next = Math.max(index - 1, 0);
        break;
      case "Enter":
        next = index === -1 ? 0 : index;
        break;
      default:
        return;
    }
    event.preventDefault();
    setSelected(rows[next]?.path ?? null);
  }

  const facetButton = (
    label: string,
    pressed: boolean,
    onClick: () => void
  ) => (
    <li key={label}>
      <button
        type="button"
        className={styles.facet}
        aria-pressed={pressed}
        onClick={onClick}
      >
        {label}
      </button>
    </li>
  );

  return (
    <>
      <section className={styles.surface} aria-label="Experiments">
        <header className={styles.header}>
          <h1 className={styles.title}>Experiments</h1>
          {/* Counts what exists, never what is owed; a failed read has no
              count at all, so it cannot pass for an empty vault. */}
          {!failed && listing.data !== undefined && runs > 0 && (
            <span className={styles.count}>
              {runs} {runs === 1 ? "run" : "runs"}
            </span>
          )}
          <div className={styles.sort} role="group" aria-label="Sort">
            <span className={styles.sortLabel}>Sort</span>
            {SORTS.map((option) => (
              <button
                key={option.sort}
                type="button"
                className={styles.sortOption}
                aria-pressed={option.sort === sort}
                onClick={() => {
                  // Shuffle again on every press, as the prototype's does.
                  if (option.sort === "shuffle") {
                    setSeed(Math.floor(Math.random() * 2 ** 31));
                  }
                  setSort(option.sort);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </header>
        <div className={styles.body}>
          <nav className={styles.facets} aria-label="Views">
            <p className={styles.facetLabel}>Inbox</p>
            <ul className={styles.facetList}>
              {INBOX_VIEWS.map(({ label, view: v }) =>
                facetButton(label, sameView(v, view), () => setView(v))
              )}
            </ul>
            <p className={styles.facetLabel}>Status</p>
            <ul className={styles.facetList}>
              {STATUS_VIEWS.map(({ label, view: v }) =>
                facetButton(label, sameView(v, view), () => setView(v))
              )}
            </ul>
            {/* Read from each run's `repo:` line, and dropped when no run
                has one — a facet with only *all projects* in it narrows
                nothing. */}
            {projects.length > 0 && (
              <>
                <p className={styles.facetLabel}>Project</p>
                <ul className={styles.facetList}>
                  {facetButton("all projects", project === undefined, () =>
                    setProject(undefined)
                  )}
                  {projects.map((p) =>
                    facetButton(p, project === p, () => setProject(p))
                  )}
                </ul>
              </>
            )}
          </nav>
          <div className={styles.column}>
            <NewExperiment onMade={onMade} />
            {rows.length === 0 && (
              <div className={styles.empty}>
                <FirstSlot
                  voice={voiceOf({
                    incomplete: failed || unreadable.length > 0,
                    answered: listing.data !== undefined,
                    read: vaultStatus.read,
                  })}
                  claim={claimOf(view, runs, project)}
                >
                  A run arrives here once you mark it complete, and stays until
                  it is written up and attached to a criterion, or abandoned.
                  Designed here, run elsewhere: the page holds the argument, and
                  the code holds the run.
                </FirstSlot>
              </div>
            )}
            <ul
              ref={listRef}
              className={styles.list}
              role="listbox"
              aria-label="Experiments"
              aria-activedescendant={selectedRowId}
              tabIndex={0}
              onKeyDown={onKeyDown}
            >
              {rows.map((row, index) => (
                <li
                  key={row.path}
                  id={rowId(index)}
                  role="option"
                  aria-selected={row.path === selected}
                  className={styles.row}
                  onClick={() => setSelected(row.path)}
                >
                  <span className={styles.name}>{row.name}</span>
                  <span className={styles.purpose}>
                    {row.purpose === "" ? "no purpose written" : row.purpose}
                  </span>
                  <span className={styles.data}>{itemsOf(row.artifacts)}</span>
                  <span className={styles.data}>{row.reading}</span>
                  <span className={`${styles.data} ${styles.age}`}>
                    {formatAge(row.when, now)}
                  </span>
                  {refusal?.path === row.path && (
                    <p className={styles.refusal} role="alert">
                      {refusal.message}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <footer className={styles.footer}>
          <span>j/k move</span>
          <span>O observations</span>
          <span>E attach</span>
          <span>D abandon</span>
          {unreadable.length > 0 && (
            <details className={styles.unreadableDetails}>
              <summary>
                {unreadable.length === 1 ? "a run" : "runs"} could not be read
              </summary>
              <ul className={styles.unreadable}>
                {unreadable.map((file) => (
                  <li key={file.path}>
                    <span>{file.path}</span>
                    <span className={styles.reason}>{file.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {vaultStatus.lines}
          {failed && (
            <WarningLine label="not read">{listing.error.message}</WarningLine>
          )}
        </footer>
        {attaching !== null && (
          <AttachEvidence
            experiment={attaching}
            onClose={() => {
              setAttaching(null);
              listRef.current?.focus();
            }}
          />
        )}
      </section>
      <RunDetail row={selectedRow} act={act} now={now} />
    </>
  );
}

/** What `O`, `E` and `D` do, from the keyboard or the detail pane. */
type Act = Record<
  "observe" | "attach" | "abandon",
  (row: ListedExperiment) => void
>;

// For aria-activedescendant; a path is unique but not id-safe, its index is.
const rowId = (index: number) => `experiment-row-${index}`;

const itemsOf = (n: number) => (n === 1 ? "1 item" : `${n} items`);

/** The *new experiment* line (#364): a name, then the page. */
function NewExperiment({ onMade }: { onMade: (path: string) => void }) {
  const trpc = useTRPC();
  const [name, setName] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const create = useMutation(
    trpc.experiments.create.mutationOptions({
      onSuccess: ({ path }) => {
        setName("");
        setRefusal(null);
        onMade(path);
      },
      onError: (error) => setRefusal(error.message),
    })
  );
  return (
    <div className={styles.make}>
      <TypedLine
        purpose="experiment"
        value={name}
        onChange={setName}
        onSubmit={(typed) => {
          if (!create.isPending) create.mutate({ name: typed });
        }}
        onDiscard={() => {
          setName("");
          setRefusal(null);
        }}
      />
      <p className={styles.makeHint}>
        new experiment — the name is the run&apos;s handle and its folder, the
        one your code and W&amp;B know it by
      </p>
      {refusal !== null && (
        <p role="alert" className={styles.makeRefusal}>
          {refusal}
        </p>
      )}
    </div>
  );
}

/**
 * The chosen run beside the list (story 62): its purpose, its first
 * Artifact, *where it ran*, and the three things to do with it — or
 * nothing, and leaving it where it is, which is as good an answer.
 */
function RunDetail({
  row,
  act,
  now,
}: {
  row: ListedExperiment | null;
  act: Act;
  now: Date;
}) {
  return (
    <aside className={styles.detail} aria-label="This run">
      {row !== null && (
        <>
          <p className={styles.detailStatus}>
            <span>{row.status ?? row.statusUnreadable ?? "no status"}</span>
            <span>{formatAge(row.when, now)}</span>
          </p>
          <p className={styles.detailName}>{row.name}</p>
          {row.purpose !== "" && (
            <p className={styles.detailPurpose}>{row.purpose}</p>
          )}
          <p className={styles.label}>Artifacts</p>
          {row.firstArtifact === null ? (
            <p className={styles.quiet}>Nothing on the page yet.</p>
          ) : (
            <>
              <ArtifactCard pagePath={row.path} item={row.firstArtifact} />
              {row.artifacts > 1 && (
                <p className={styles.quiet}>
                  the first of {itemsOf(row.artifacts)}
                </p>
              )}
            </>
          )}
          <p className={styles.label}>Triage — or leave it</p>
          <div className={styles.actions}>
            <button type="button" onClick={() => act.observe(row)}>
              Write observations
              <kbd aria-hidden>O</kbd>
            </button>
            <button type="button" onClick={() => act.attach(row)}>
              Attach to a criterion
              <kbd aria-hidden>E</kbd>
            </button>
            {row.status !== "abandoned" && (
              <button type="button" onClick={() => act.abandon(row)}>
                Abandon
                <kbd aria-hidden>D</kbd>
              </button>
            )}
          </div>
          <p className={styles.label}>Where it ran</p>
          {row.whereItRan.length === 0 ? (
            <p className={styles.quiet}>Not written.</p>
          ) : (
            <dl className={styles.whereItRan}>
              {row.whereItRan.map((line, i) => (
                <div key={i}>
                  {line.label !== null && <dt>{line.label}</dt>}
                  <dd>{line.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
    </aside>
  );
}
