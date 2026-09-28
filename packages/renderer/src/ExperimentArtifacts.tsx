import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ArtifactAs,
  ArtifactLine,
  ExperimentSections,
  LinkedArtifact,
  StoredArtifact,
} from "core";
import { useEffect, useRef, useState } from "react";
import styles from "./Experiment.module.css";
import { Outline, Section } from "./ResearchQuestion";
import rq from "./ResearchQuestion.module.css";
import { useTRPC } from "./trpc";
import { TypedLine } from "./TypedLine";

/**
 * An Experiment's Artifacts (spec #362 stories 28, 32–35, 37–38; prompt 5;
 * prototype 05's artifact area): the record of the run, drawn to be looked
 * at rather than filed as chips — an image inline at the column's width,
 * anything else a named card with its size, every one in the order the
 * file holds them.
 *
 * *+ artifact* asks the Host's file chooser; a file or a URL dropped on
 * the page arrives as `adding` from the page, which owns the drop. Either
 * way the core is asked what it proposes — stored under 25 MB, linked at or
 * above it, a URL always linked (ADR 0035 decision 4) — and the caption is
 * asked for next, with the proposal said beside it and the other choice one
 * button away (story 31). Only then is anything copied or linked.
 */
export function Artifacts({
  path,
  section,
  adding,
  onAdding,
}: {
  path: string;
  section: ExperimentSections["artifacts"];
  /** The file waiting for its caption, as a path on disk; null when none is. */
  adding: string | null;
  onAdding: (source: string | null) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [said, setSaid] = useState<string | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);

  const done = () => {
    onAdding(null);
    addRef.current?.focus();
  };
  const pick = useMutation(trpc.experiments.pickArtifact.mutationOptions());
  const add = useMutation(trpc.experiments.addArtifact.mutationOptions());
  // One chooser, and one copy, at a time: a second ↵ while the copy is on
  // its way would store the file again as `plot (2).png`. A ref rather than
  // `isPending`, because the second ↵ can arrive before the render that
  // would have told this handler the first was pending.
  const busy = useRef(false);
  const release = () => {
    busy.current = false;
  };
  // The callbacks go with each call rather than into the options: they hand
  // the keyboard back to *+ artifact*, which is a ref, and the options are
  // built during render.
  const choose = () => {
    if (busy.current) return;
    busy.current = true;
    pick.mutate(undefined, {
      onSuccess: ({ source }) => {
        if (source === null) {
          addRef.current?.focus();
          return;
        }
        setSaid(null);
        onAdding(source);
      },
      onError: (error) =>
        setSaid(`could not open the chooser: ${error.message}`),
      onSettled: release,
    });
  };
  const addAs = (source: string, as: ArtifactAs, text: string) => {
    if (busy.current) return;
    busy.current = true;
    add.mutate(
      { path, source, as, caption: text },
      {
        onSuccess: (result) => {
          // The copy lands before the line: a refused line still means a
          // file in the folder, so the caption line closes either way —
          // adding again would copy a second one.
          setSaid(
            result.written
              ? null
              : `${result.file} is in the run's folder, but its line could not be written: ${result.detail}`
          );
          done();
          void queryClient.invalidateQueries(
            trpc.experiments.page.queryFilter({ path })
          );
        },
        // Refused before anything was copied: the caption is kept to try again.
        onError: (error) => setSaid(`could not add it: ${error.message}`),
        onSettled: release,
      }
    );
  };

  return (
    <Section
      name="Artifacts"
      present={section.present}
      action={
        <button ref={addRef} type="button" className={rq.edit} onClick={choose}>
          + artifact
        </button>
      }
    >
      {adding !== null && (
        // Keyed by the file, so a second drop starts with an empty caption
        // and a fresh proposal rather than lending it the first file's.
        <CaptionLine
          key={adding}
          source={adding}
          onSubmit={(as, text) => addAs(adding, as, text)}
          onDiscard={done}
          onRefused={(message) => {
            setSaid(`could not add it: ${message}`);
            done();
          }}
        />
      )}
      {said !== null && (
        <p role="status" className={styles.refusal}>
          {said}
        </p>
      )}
      {section.items.length === 0 ? (
        adding === null && (
          <Outline>
            Nothing yet. Plots, screenshots and data snippets are the record of
            the run: add one, or drop a file on the page, and it is copied in
            beside the run.
          </Outline>
        )
      ) : (
        <ul className={styles.artifacts}>
          {section.items.map((item, i) => (
            <li key={i}>
              <ArtifactCard item={item} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/**
 * The caption line, with the file it is for named above it and what the
 * core proposes for it: stored, or linked with the brief's warning (KEEP-9).
 * The other choice is one button away, and switching keeps what was typed
 * — the line is re-made for its new purpose, so it takes the keyboard back.
 * A URL has no bytes to copy, so it is only ever linked.
 */
function CaptionLine({
  source,
  onSubmit,
  onDiscard,
  onRefused,
}: {
  source: string;
  onSubmit: (as: ArtifactAs, text: string) => void;
  onDiscard: () => void;
  /** The file could not be looked at: nothing can be added, so the line closes and says why. */
  onRefused: (message: string) => void;
}) {
  const trpc = useTRPC();
  const inspected = useQuery({
    ...trpc.experiments.inspectArtifact.queryOptions({ source }),
    // A file gone or unreadable is not going to come back by asking again.
    retry: false,
  });
  const [caption, setCaption] = useState("");
  // The user's choice, once they have made one; until then, the proposal.
  const [chose, setChose] = useState<ArtifactAs | null>(null);
  const refusal = inspected.isError ? inspected.error.message : null;
  useEffect(() => {
    if (refusal !== null) onRefused(refusal);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per refusal
  }, [refusal]);
  if (inspected.data === undefined) {
    return (
      <div className={styles.adding}>
        <span className={styles.addingName}>{fileOf(source)}</span>
      </div>
    );
  }
  const { size, proposed } = inspected.data;
  const as = chose ?? proposed;
  const url = size === null;
  const other: ArtifactAs = as === "stored" ? "linked" : "stored";
  return (
    <div className={styles.adding} data-as={as}>
      <div className={styles.artifactHead}>
        <span className={styles.addingName}>
          {url ? source : fileOf(source)}
        </span>
        <span className={styles.caption}>
          {url ? "URL" : formatSize(size)} ·{" "}
          {as === "stored" ? "copied into the vault" : "linked, not copied"}
        </span>
        {!url && (
          <button
            type="button"
            className={rq.edit}
            onClick={() => setChose(other)}
          >
            {other === "stored" ? "copy it in instead" : "link it instead"}
          </button>
        )}
      </div>
      {as === "linked" && <p className={styles.warning}>{warningFor(url)}</p>}
      <TypedLine
        key={as}
        purpose={as === "stored" ? "caption" : "description"}
        value={caption}
        onChange={setCaption}
        onSubmit={(text) => onSubmit(as, text)}
        onDiscard={onDiscard}
      />
    </div>
  );
}

/** The name a path on disk ends in — all the caption line needs to say which file it is for. */
const fileOf = (source: string) => source.replace(/^.*[/\\]/, "");

/**
 * The warning the brief asks for rather than a silent link (§ Artifact
 * storage): the vault cannot see outside itself, so a linked Artifact can
 * vanish without anything here noticing. Prototype 05's words.
 */
function warningFor(url: boolean): string {
  return url
    ? "Outside the vault. If this page moves or is taken down, the vault will not notice and this link will point at nothing."
    : "Outside the vault. If this file moves or is cleaned up, the vault will not notice and this page will point at nothing.";
}

function ArtifactCard({ item }: { item: ArtifactLine }) {
  if (item.kind === "asWritten") {
    return <p className={styles.asWritten}>{item.text}</p>;
  }
  if (item.kind === "linked") return <LinkedCard item={item} />;
  return (
    <figure className={styles.artifact} data-kind="stored">
      <div className={styles.artifactHead}>
        <span className={styles.artifactName}>{item.file}</span>
        <span className={styles.caption}>{sizeLine(item)}</span>
      </div>
      {item.image && item.path !== null && (
        <ArtifactImage path={item.path} alt={item.caption || item.file} />
      )}
      {item.caption !== "" && (
        <figcaption className={styles.artifactCaption}>
          {item.caption}
        </figcaption>
      )}
    </figure>
  );
}

/**
 * A linked Artifact (stories 38–39; prototype 05's warning card): where it
 * is, how big, the machine it was linked on and when — enough to find it
 * again — and the warning, since nothing here will notice if it goes.
 * Nothing is fetched for it: its bytes are not the vault's to serve.
 */
function LinkedCard({ item }: { item: LinkedArtifact }) {
  return (
    <figure
      className={`${styles.artifact} ${styles.linked}`}
      data-kind="linked"
    >
      <div className={styles.artifactHead}>
        <span className={styles.artifactName}>{item.file}</span>
        <span className={styles.linkedMark}>
          {item.url ? "URL" : item.size} · linked
        </span>
      </div>
      <span className={styles.target}>{item.target}</span>
      <p className={styles.warning}>{warningFor(item.url)}</p>
      <span className={styles.caption}>
        linked on {item.machine} · {item.date}
      </span>
      {item.description !== "" && (
        <figcaption className={styles.artifactCaption}>
          {item.description}
        </figcaption>
      )}
    </figure>
  );
}

/** `412 KB · in vault`; a line whose file the folder does not hold says so rather than drawing a gap. */
function sizeLine(item: StoredArtifact): string {
  if (item.size === null) return "not in the folder";
  return `${formatSize(item.size)} · in vault`;
}

/** Bytes as the prototype writes them: `412 KB`, `1.1 MB`. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/**
 * An image Artifact, drawn from its bytes. An `<img src>` cannot carry the
 * bearer header, and the token never travels in a URL, so the bytes are
 * fetched with the header and drawn from an object URL — which the page's
 * CSP allows as `blob:` for images and nothing else (#366). A fetch that
 * fails says so where the image would be.
 */
function ArtifactImage({ path, alt }: { path: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    const aborted = new AbortController();
    let url: string | null = null;
    const { port, token } = window.vitrine;
    const address = path.split("/").map(encodeURIComponent).join("/");
    fetch(`http://127.0.0.1:${port}/artifacts/${address}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: aborted.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`the core answered ${res.status}`);
        url = URL.createObjectURL(await res.blob());
        setSrc(url);
      })
      .catch((error: unknown) => {
        if (aborted.signal.aborted) return;
        setFailed(error instanceof Error ? error.message : String(error));
      });
    return () => {
      aborted.abort();
      if (url !== null) URL.revokeObjectURL(url);
    };
  }, [path]);
  if (failed !== null) {
    return <p className={styles.caption}>could not draw it: {failed}</p>;
  }
  return src === null ? (
    <div className={styles.imageWaiting} />
  ) : (
    <img className={styles.image} src={src} alt={alt} />
  );
}
