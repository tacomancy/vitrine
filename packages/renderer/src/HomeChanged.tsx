import { useQuery } from "@tanstack/react-query";
import { formatAge } from "./age";
import { FirstSlot, voiceOf } from "./FirstSlot";
import styles from "./Home.module.css";
import { hashOf, type Route } from "./router";
import { useTRPC } from "./trpc";
import { useVaultStatusLines } from "./VaultStatusLines";

type Topic =
  | { kind: "tag"; tag: string }
  | { kind: "invalid"; reason: string }
  | { kind: "untagged" };

const heading = (topic: Topic) =>
  topic.kind === "tag"
    ? topic.tag
    : topic.kind === "invalid"
      ? `invalid tag · ${topic.reason}`
      : "untagged";

/**
 * *Changed while you were away* (spec #728, RES-4): the core's groups, drawn
 * as threads to pick up. Nothing here counts anything — no total of changes
 * and no "and N more" — so the group just ends where the core ended it. A Note
 * opens in the Vault; a Question at its own Address.
 */
export function HomeChanged() {
  const trpc = useTRPC();
  const status = useVaultStatusLines();
  const changed = useQuery(trpc.home.changed.queryOptions());
  const now = new Date();

  if (changed.error)
    return (
      <Section>
        <FirstSlot
          voice="wrong"
          claim=""
          fragment={`could not tell what changed · ${changed.error.message}`}
        />
      </Section>
    );
  if (changed.data === undefined) return null;

  if (changed.data.groups.length === 0) {
    // Only a vault read in full and watched may claim that nothing changed.
    if (
      voiceOf({ incomplete: false, answered: true, read: status.read }) !==
      "claim"
    )
      return null;
    const since = new Date(changed.data.since).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    });
    return (
      <Section>
        <FirstSlot
          voice="claim"
          claim="Nothing has changed."
          warrant={`looked at questions, notes, revisions, accepted stubs and runs since ${since}`}
        />
      </Section>
    );
  }

  return (
    <Section>
      {changed.data.groups.map((group) => (
        <div key={JSON.stringify(group.topic)} className={styles.topic}>
          <h3 className={styles.topicName}>{heading(group.topic)}</h3>
          <ul className={styles.items}>
            {group.items.map((item) => (
              <li key={`${item.path}:${item.sentence}:${item.at}`}>
                <a className={styles.item} href={hashOf(routeOf(item))}>
                  {item.title}
                </a>
                <span className={styles.what}>
                  {item.sentence} · {formatAge(item.at, now)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Section>
  );
}

/** Each Kind opens at its own Address; a Note, which has none, opens in the Vault. */
function routeOf(item: { kind: string; path: string }): Route {
  switch (item.kind) {
    case "note":
      return { surface: "vault", path: item.path };
    case "research-question":
    case "hypothesis":
    case "experiment":
    case "source":
      return { surface: item.kind, path: item.path };
    default:
      return { surface: "inbox", question: item.path };
  }
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section className={styles.changed} aria-labelledby="home-changed-title">
      <h2 id="home-changed-title" className={styles.sectionTitle}>
        Changed while you were away
      </h2>
      {children}
    </section>
  );
}
