import { useQuery } from "@tanstack/react-query";
import { FirstSlot, voiceOf } from "./FirstSlot";
import styles from "./Home.module.css";
import { hashOf, SCOUTS } from "./router";
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

  const failure = fleet.error ?? health.error ?? tree.error;
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
            fragment={`could not tell whether the scouts are looking · ${failure.message}`}
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

  // The core's claim is one line of ` · `-joined parts, headline first, with
  // the Scouts not looking last when there are any. Home states those in the
  // sentence, where they are named and never counted, so the Warrant leaves
  // them out rather than saying them twice.
  const [headline = "", ...rest] = fleet.claim.split(" · ");
  const warrant = (fleet.naming.length > 0 ? rest.slice(0, -1) : rest).join(
    " · "
  );
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
