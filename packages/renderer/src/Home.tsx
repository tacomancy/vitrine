import { useQuery } from "@tanstack/react-query";
import type { ReviewDepth } from "core";
import { FirstSlot, voiceOf } from "./FirstSlot";
import styles from "./Home.module.css";
import { HomeChanged } from "./HomeChanged";
import { hashOf, SCOUTS, SKIM_LANE } from "./router";
import { useTRPC } from "./trpc";
import { useVaultStatusLines } from "./VaultStatusLines";

/** 14 → "14th", 21 → "21st"; the teens take *th*. */
const ordinal = (n: number) => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
};

/**
 * *Monday 21 September · 10:04*, and — only after a gap — *away since the
 * 14th*: the day the previous visit was, so the page says what a later
 * section is measured against. The month is named only when it is not this
 * one, because *the 14th* alone would read as the wrong month.
 */
export function dateline(now: Date, since: string | null): string {
  const day = now.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const time = now.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const stamp = `${day} · ${time}`;
  if (since === null) return stamp;
  const [year, month, date] = since.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const named =
    month === now.getMonth() + 1 && year === now.getFullYear()
      ? ""
      : ` of ${new Date(year, month - 1, 1).toLocaleDateString("en-GB", { month: "long" })}`;
  return `${stamp} · away since the ${ordinal(date)}${named}`;
}

/**
 * Home (spec #728): the window's landing. Its first slot speaks in one of
 * ADR 0032's Voices and claims coverage of *looking* — never the absence of
 * failure, so *nothing is broken* is said nowhere. Everything the sentence
 * rests on is the core's: the fleet claim and its Warrant come from
 * `scouts.fleet`, which Review's and Skim's empty lanes read too, so the three
 * cannot disagree about whether the field is being watched.
 */
export function Home() {
  const trpc = useTRPC();
  const status = useVaultStatusLines();
  const away = useQuery(trpc.home.away.queryOptions());
  const health = useQuery(trpc.scouts.health.queryOptions());
  const fleet = useQuery(trpc.scouts.fleet.queryOptions());
  const tree = useQuery(trpc.vault.tree.queryOptions());
  const depth = useQuery(trpc.scouts.depth.queryOptions());

  const scoutsFailure = fleet.error ?? health.error;
  const failure = scoutsFailure ?? tree.error;
  const voice = voiceOf({
    // A failed read is said by its own sentence below, before the Voice is asked.
    incomplete: false,
    answered:
      health.data !== undefined &&
      fleet.data !== undefined &&
      tree.data !== undefined,
    read: status.read,
  });

  return (
    <section className={styles.home} aria-labelledby="home-title">
      <div className={styles.header}>
        <h1 id="home-title" className={styles.title}>
          Home
        </h1>
        <span className={styles.dateline}>
          {dateline(new Date(), away.data?.since ?? null)}
        </span>
      </div>
      <div className={styles.scroll}>
        {failure !== null && failure !== undefined ? (
          // A failed read is not a fleet of none: it says it could not tell.
          <FirstSlot
            voice="wrong"
            claim=""
            fragment={`could not tell ${scoutsFailure ? "whether the scouts are looking" : "what the vault holds"} · ${failure.message}`}
          />
        ) : voice === "claim" &&
          health.data !== undefined &&
          fleet.data !== undefined &&
          tree.data !== undefined ? (
          <FirstSentence
            health={health.data}
            fleet={fleet.data}
            empty={tree.data.length === 0}
          />
        ) : (
          <FirstSlot voice={voice} claim="" fragment="reading" />
        )}
        {failure === null &&
          voice === "claim" &&
          health.data !== undefined &&
          fleet.data !== undefined &&
          (health.data.scouts.length > 0 ||
            health.data.unreadable.length > 0) &&
          (depth.data !== undefined || depth.error !== null) && (
            <Waiting
              depth={depth.data}
              failure={depth.error?.message}
              fleet={fleet.data}
            />
          )}
        <HomeChanged />
      </div>
    </section>
  );
}

type Health = {
  scouts: Array<{ health: { voice: string } }>;
  unreadable: unknown[];
};
type Fleet = { claim: string | null; naming: string[] };

/**
 * The core's claim is one line of ` · `-joined parts, headline first, with
 * the Scouts not looking last when there are any. Home states those in a
 * sentence of its own, where they are named and never counted, so the Warrant
 * leaves them out rather than saying them twice.
 */
function claimParts(claim: string, naming: string[]) {
  const [headline = "", ...rest] = claim.split(" · ");
  const warrant = (naming.length > 0 ? rest.slice(0, -1) : rest).join(" · ");
  return { headline, warrant };
}

/**
 * The sentence, once the vault has been read in full and watched and the
 * Scouts have answered. Which Voice is a matter of the fleet: a broken Scout
 * withholds the claim and is named in its place; no Scouts is *not yet*, not a
 * clean bill; a vault that holds nothing says so as a claim.
 */
function FirstSentence({
  health,
  fleet,
  empty,
}: {
  health: Health;
  fleet: Fleet;
  empty: boolean;
}) {
  const none = health.scouts.length === 0 && health.unreadable.length === 0;
  const broken =
    health.unreadable.length > 0 ||
    health.scouts.some((s) => s.health.voice === "wrong");

  if (broken)
    return (
      <FirstSlot
        voice="wrong"
        claim=""
        fragment={`${fleet.naming.join(", ")} not working`}
      />
    );
  if (none && empty)
    return (
      <FirstSlot voice="claim" claim="Nothing here yet.">
        You can capture a question with{" "}
        <kbd className={styles.chord}>⌘&apos;</kbd> from anywhere, or put a PDF
        in the PDF folder.
      </FirstSlot>
    );
  if (none)
    return (
      <FirstSlot
        voice="not yet"
        claim=""
        fragment="no scouts yet"
        action={
          <a className={styles.way} href={hashOf(SCOUTS)}>
            brief one
          </a>
        }
      />
    );
  if (fleet.claim === null)
    return (
      <FirstSlot
        voice="not yet"
        claim=""
        fragment={`${fleet.naming.join(", ")} not looking yet`}
      />
    );

  const { headline, warrant } = claimParts(fleet.claim, fleet.naming);
  return (
    <FirstSlot
      voice="claim"
      claim={
        fleet.naming.length > 0
          ? `${headline}. These are not: ${fleet.naming.join(", ")}.`
          : `${headline}.`
      }
      warrant={warrant}
    />
  );
}

/**
 * Waiting: what Review holds, as the core's own figure (`scouts.depth`, the
 * one Scout Activity's header carries), and a Skim line saying a feed has no
 * depth. Age is a neutral fact beside the figure, deferred is kept out of the
 * headline, and the aged ones the Queue folds into its digest stay inside it:
 * aging decides nothing (ADR 0044), so a week away reads as a week's arrivals
 * and not as a failure. An empty Review is a claim only the fleet can warrant,
 * so with a Scout broken it is not made — the Scout is named instead.
 */
function Waiting({
  depth,
  failure,
  fleet,
}: {
  depth: ReviewDepth | undefined;
  failure: string | undefined;
  fleet: Fleet;
}) {
  const { headline, warrant } =
    fleet.claim === null
      ? { headline: "", warrant: "" }
      : claimParts(fleet.claim, fleet.naming);
  return (
    <section className={styles.waiting} aria-labelledby="home-waiting">
      <h2 id="home-waiting" className={styles.heading}>
        Waiting
      </h2>
      {depth === undefined ? (
        <FirstSlot
          voice="wrong"
          claim=""
          fragment={`could not tell what waits in Review · ${failure ?? ""}`}
        />
      ) : depth.pending > 0 ? (
        <p className={styles.line}>
          <span>{depth.pending} in Review</span>
          <span className={styles.fact}>
            {[
              depth.median && `median ${depth.median.ago}`,
              depth.oldest && `oldest ${depth.oldest.ago}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          {depth.pastWindow > 0 && (
            <span className={styles.fact}>
              {depth.pastWindow} older than their window, included
            </span>
          )}
          {depth.deferred > 0 && (
            <span className={styles.fact}>{depth.deferred} deferred</span>
          )}
          <a className={styles.way} href={hashOf(SCOUTS)}>
            open review
          </a>
        </p>
      ) : (
        <p className={styles.line}>
          <span>
            {fleet.claim !== null
              ? `Review is empty — ${[headline, warrant].filter(Boolean).join(" · ")}.`
              : "Nothing pending, and no claim that the field is quiet."}
          </span>
          {depth.deferred > 0 && (
            <span className={styles.fact}>{depth.deferred} deferred</span>
          )}
          <a className={styles.way} href={hashOf(SCOUTS)}>
            open review
          </a>
        </p>
      )}
      <p className={styles.line}>
        <span>Skim is a feed with no depth, so it is not counted here.</span>
        <a className={styles.way} href={hashOf(SKIM_LANE)}>
          glance
        </a>
      </p>
    </section>
  );
}
