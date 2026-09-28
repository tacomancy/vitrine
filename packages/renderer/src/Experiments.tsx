import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import styles from "./Experiment.module.css";
import { useTRPC } from "./trpc";
import { TypedLine } from "./TypedLine";

/**
 * The Experiment surface, at `#/experiments`: where a run is made by typing
 * the short name it goes by in the user's code and W&B (spec #362 stories
 * 1–5). The name lands as the Experiment's folder and its Display name; a
 * taken one is refused with the core's reason and the typing kept, so it
 * can be changed rather than retyped. A made run opens on its page.
 *
 * The Experiment Inbox — the surface's default view once it exists — is
 * #371's; every run made meanwhile is one ⌘K away by name.
 */
export function Experiments({
  onMade,
}: {
  /** Where the made run's page opens — the window's, since it moves the Address. */
  onMade: (path: string) => void;
}) {
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
    <section className={styles.surface} aria-label="Experiments">
      <header className={styles.surfaceHeader}>
        <h1 className={styles.surfaceTitle}>Experiments</h1>
        <p className={styles.caption}>
          designed and recorded here, run elsewhere
        </p>
      </header>
      <div className={styles.surfaceBody}>
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
        <p className={styles.caption}>
          the name is the run&apos;s handle and its folder — the one your code
          and W&amp;B know it by
        </p>
        {refusal !== null && (
          <p role="status" className={styles.refusal}>
            {refusal}
          </p>
        )}
      </div>
    </section>
  );
}
