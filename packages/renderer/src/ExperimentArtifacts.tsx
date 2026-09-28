import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ArtifactLine, ExperimentSections, StoredArtifact } from "core";
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
 * *+ artifact* asks the Host's file chooser; a file dropped on the page
 * arrives as `adding` from the page, which owns the drop. Either way the
 * caption is asked for next, and only then is anything copied (ADR 0035
 * decision 1). Every Artifact added here is stored; proposing a heavy one
 * as linked is #369's.
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
  const copyIn = (source: string, text: string) => {
    if (busy.current) return;
    busy.current = true;
    add.mutate(
      { path, source, caption: text },
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
        // rather than lending it the first file's.
        <CaptionLine
          key={adding}
          source={adding}
          onSubmit={(text) => copyIn(adding, text)}
          onDiscard={done}
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

/** The caption line, with the file it is for named above it. */
function CaptionLine({
  source,
  onSubmit,
  onDiscard,
}: {
  source: string;
  onSubmit: (text: string) => void;
  onDiscard: () => void;
}) {
  const [caption, setCaption] = useState("");
  return (
    <div className={styles.adding}>
      <span className={styles.addingName}>{fileOf(source)}</span>
      <TypedLine
        purpose="caption"
        value={caption}
        onChange={setCaption}
        onSubmit={onSubmit}
        onDiscard={onDiscard}
      />
    </div>
  );
}

/** The name a path on disk ends in — all the caption line needs to say which file it is for. */
const fileOf = (source: string) => source.replace(/^.*[/\\]/, "");

export function ArtifactCard({ item }: { item: ArtifactLine }) {
  if (item.kind === "asWritten") {
    return <p className={styles.asWritten}>{item.text}</p>;
  }
  return (
    <figure className={styles.artifact}>
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
