import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReaderAnnotation, SourcePage } from "core";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnnotationOverlay } from "./AnnotationOverlay";
import { ConnectionsPanel, ticksOf, type Tick } from "./Connections";
import { classifyLink, refusal } from "./link-rule";
import { FrameLines, usePageFrame } from "./page-frame";
import { HighlightBar } from "./HighlightBar";
import { PdfDocument, type PageSelection } from "./pdf-document";
import styles from "./Reader.module.css";
import rq from "./ResearchQuestion.module.css";
import { usePublishReading } from "./reading";
import type { Arrival } from "./router";
import { useTRPC } from "./trpc";

type Readable = Extract<SourcePage, { readable: true }>;

/**
 * The Reader (brief § Reading on iPad; prompt 2; spec #416 stories 70–89),
 * at `#/source/<path>` — a Source open on its paper. Calm view first: the
 * page in a plain measure, the chrome a header line and a margin that
 * recede. The page is PDF.js's, behind `PdfDocument`; the highlights and
 * notes are the app's own overlay from the core's records.
 *
 * The Address's arrival (`?page`, `?block`) is read once, when the paper
 * opens, and the hash is never written as the reader moves: it is where they
 * came in. Where they *stopped* is the core's, remembered per Source.
 *
 * A stub has no Reader (story 73): the core will not read one as a Source,
 * so the frame lands it on the Inbox naming its Address like any other one
 * that does not resolve.
 */
export function Reader({
  path,
  arrival,
}: {
  path: string;
  arrival: Arrival | undefined;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const page = useQuery(trpc.sources.page.queryOptions({ path }));
  const { sectionRef, removed, resolved } = usePageFrame(
    "source",
    path,
    page.data
  );
  const data = removed === null && page.data?.readable ? page.data : null;

  // An evicted PDF is brought down by opening it, and then it is ingested;
  // the page is read again to show what that found (stories 23, 24).
  const bring = useMutation(
    trpc.sources.bringDown.mutationOptions({
      onSettled: () =>
        queryClient.invalidateQueries(trpc.sources.page.pathFilter()),
    })
  );
  const bringing = useRef(false);
  const evicted = data?.evicted === true;
  useEffect(() => {
    if (!evicted || bringing.current) return;
    bringing.current = true;
    bring.mutate({ path });
  }, [evicted, bring, path]);

  // What points at this paper: the gutter's ticks and the panel's rows are
  // the one answer, so the two cannot disagree (stories 80–86).
  const connections = useQuery({
    ...trpc.sources.connections.queryOptions({ path }),
    enabled: data !== null,
  });
  const [panel, setPanel] = useState(false);
  // A renderer key handler, not a native shortcut: the chord is the app's.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && event.key === ";") {
        event.preventDefault();
        setPanel((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  const ticks = ticksOf(connections.data ?? []);

  return (
    <section
      ref={sectionRef}
      className={rq.page}
      aria-label="Reader"
      tabIndex={-1}
    >
      <FrameLines
        error={page.isError ? page.error : null}
        removed={removed}
        resolved={resolved}
        data={page.data}
      />
      {data !== null && (
        <div className={styles.reader}>
          <div className={styles.paper}>
            <Header source={data} />
            {data.pdf === null ? (
              <p className={styles.line}>
                This Source names a PDF that is not in the vault.
              </p>
            ) : evicted ? (
              // Said either way: a bring-down that came back empty or failed
              // must not read as one still going.
              <p className={styles.line} role="status">
                {bring.isError || bring.data?.brought === false
                  ? "The PDF is not on this Mac yet: your sync folder has not delivered it."
                  : "Bringing the PDF down from your sync folder…"}
              </p>
            ) : (
              <Paper
                path={path}
                source={data}
                pdf={data.pdf}
                arrival={arrival}
                ticks={ticks}
              />
            )}
          </div>
          {panel ? (
            <ConnectionsPanel
              connections={connections.data}
              error={connections.isError ? connections.error.message : null}
              onClose={() => setPanel(false)}
            />
          ) : (
            <Margin annotations={data.annotations} arrival={arrival} />
          )}
        </div>
      )}
    </section>
  );
}

/** The Source's own fields, and its link — the one thing here written by someone else. */
function Header({ source }: { source: Readable }) {
  const [said, setSaid] = useState<string | null>(null);
  const link = source.url === null ? null : classifyLink(source.url);
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>{source.title ?? source.citekey}</h1>
      <p className={styles.byline}>
        {[source.authors.join(", "), source.year]
          .filter((part) => part !== null && part !== "")
          .join(" · ")}
      </p>
      {source.url !== null && link !== null && (
        <p className={styles.byline}>
          {link.kind === "refused" ? (
            // Drawn as plainly not a link, and it says so when asked (story
            // 88): a click that did nothing would look like one that worked.
            <button
              type="button"
              className={styles.notLink}
              aria-label={`not a link: ${source.url}`}
              onClick={() => setSaid(refusal(link.scheme))}
            >
              {source.url}
            </button>
          ) : (
            <a
              href={link.href}
              // The shell hands it to the browser; nothing in the window moves.
              target="_blank"
              rel="noreferrer"
            >
              {source.url}
            </a>
          )}
        </p>
      )}
      {said !== null && (
        <p className={styles.line} role="status">
          {said}
        </p>
      )}
    </header>
  );
}

/** The paper and its overlay, opened where the Address or the last visit says. */
function Paper({
  path,
  source,
  pdf,
  arrival,
  ticks,
}: {
  path: string;
  source: Readable;
  pdf: string;
  arrival: Arrival | undefined;
  ticks: Tick[];
}) {
  const trpc = useTRPC();
  const remember = useMutation(trpc.sources.readingPosition.mutationOptions());
  const [failed, setFailed] = useState<string | null>(null);
  const [selection, setSelection] = useState<PageSelection | null>(null);

  // Frozen at mount: an arrival wins over the remembered place, and neither
  // is chased once the reader has begun to move.
  const [opened] = useState(() => {
    if (arrival && "page" in arrival) return { page: arrival.page, offset: 0 };
    if (arrival) {
      const block = source.annotations.find((a) => a.block === arrival.block);
      if (block) return { page: block.page + 1, offset: 0 };
    }
    return source.position ?? { page: 1, offset: 0 };
  });
  const arrivedOn = arrival && "block" in arrival ? arrival.block : null;

  // The page in view, for the capture chord (#427): where the paper opened
  // until the reader moves.
  const [inView, setInView] = useState(opened.page);
  const spend = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }, []);
  usePublishReading({
    source: path,
    page: selection?.page ?? inView,
    selection,
    spend,
  });
  const onMove = useCallback(
    ({ page, offset }: { page: number; offset: number }) => {
      setInView(page);
      remember.mutate({ path, page, offset });
    },
    // `mutate` is stable; the mutation object is not, and would rebind the
    // scroll listener on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path]
  );

  if (failed !== null) {
    return (
      <p className={styles.line} role="status">
        The paper could not be shown because {failed}.
      </p>
    );
  }
  const session = window.vitrine as Window["vitrine"] | undefined;
  return (
    <>
      {remember.isError && (
        <p className={styles.line} role="status">
          Where you stopped could not be saved.
        </p>
      )}
      {arrivedOn !== null &&
        !source.annotations.some((a) => a.block === arrivedOn) && (
          <p className={styles.line} role="status">
            This paper has no highlight {arrivedOn} to arrive on.
          </p>
        )}
      <PdfDocument
        url={`http://127.0.0.1:${session?.port ?? 0}/pdf/${pdf
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`}
        token={session?.token ?? ""}
        start={opened}
        onMove={onMove}
        onFailed={setFailed}
        onSelect={setSelection}
        overlay={(geometry) => (
          <AnnotationOverlay
            page={geometry}
            annotations={source.annotations}
            arrivedOn={arrivedOn}
            ticks={ticks}
          />
        )}
      />
      {selection !== null && (
        <HighlightBar
          path={path}
          selection={selection}
          onDone={() => setSelection(null)}
        />
      )}
    </>
  );
}

/**
 * The margin, receded: what is marked in this paper, as plain text. A quote
 * and a note are shown as the words they are and never parsed for links —
 * text this app did not write is not an address (story 89).
 */
function Margin({
  annotations,
  arrival,
}: {
  annotations: ReaderAnnotation[];
  arrival: Arrival | undefined;
}) {
  if (annotations.length === 0) return null;
  return (
    <aside className={styles.margin} aria-label="Annotations">
      <ul className={styles.notes}>
        {annotations.map((a) => (
          <li
            key={a.id}
            className={styles.note}
            aria-current={
              arrival && "block" in arrival && arrival.block === a.block
                ? "location"
                : undefined
            }
          >
            <span className={styles.where}>
              p.{a.page + 1}
              {a.question && " · ? question"}
            </span>
            {a.quote !== "" && <q className={styles.quote}>{a.quote}</q>}
            {a.note !== "" && <span className={styles.noteText}>{a.note}</span>}
          </li>
        ))}
      </ul>
    </aside>
  );
}
