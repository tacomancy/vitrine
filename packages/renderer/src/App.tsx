import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Provenance, Question } from "core";
import { useState } from "react";
import styles from "./App.module.css";
import { CaptureLine } from "./CaptureLine";
import { Experiment } from "./Experiment";
import { Experiments } from "./Experiments";
import { useCoreEvents, VaultChangedListeners } from "./events";
import { FirstRun } from "./FirstRun";
import { GlobalCommand } from "./GlobalCommand";
import { Hypothesis } from "./Hypothesis";
import { Inbox } from "./Inbox";
import { LooseEnds } from "./LooseEnds";
import { ResearchQuestion } from "./ResearchQuestion";
import { pushRoute, useRoute } from "./router";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";
import { useTRPC } from "./trpc";

export function App() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const vault = useQuery(trpc.vault.current.queryOptions());
  const listeners = useCoreEvents();
  const route = useRoute();
  // The last Question either chord wrote. The Inbox re-reads the vault
  // and makes it the selection, so the user sees it land (brief § Question
  // Inbox: "everything captured recently, newest first").
  const [landed, setLanded] = useState<Question | null>(null);
  // A Loose Ends row's *attach a source* is one gesture across two
  // surfaces: it moves the window to the page and asks that page to open
  // its attach form on arrival. The intent is spent by that arrival, so
  // returning to the same address later is an ordinary visit.
  const [attachOnArrival, setAttachOnArrival] = useState<string | null>(null);

  const onCaptured = (question: Question) => {
    void queryClient.invalidateQueries(trpc.questions.list.pathFilter());
    // A capture made on a page appended its link there (§ Vault layout),
    // or joins a Hypothesis's related rail, which is a query over `from:`.
    void queryClient.invalidateQueries(
      trpc.researchQuestions.page.pathFilter()
    );
    void queryClient.invalidateQueries(trpc.hypotheses.page.pathFilter());
    setLanded(question);
  };

  // What a capture records as Provenance (CONTEXT.md), whichever chord
  // made it: pursuing the page at this address — a Research Question's or
  // a Hypothesis's — otherwise Unattached. The address names a file, not a
  // Kind; a capture on a page of any other Kind is refused by the core,
  // loudly, where it was made. The follow-up a Hypothesis's result raises
  // is `resolving`, and is the page's own line, not the chord's. The
  // Reader will add *reading* here when it exists.
  const provenance: Provenance =
    route.surface === "research-question" || route.surface === "hypothesis"
      ? { context: "pursuing", page: route.path }
      : { context: "other" };

  // Nothing is drawn until the core has answered: a First run that flashes
  // before a remembered vault appears would say something untrue.
  if (vault.isPending) return <div className={styles.window} />;

  if (vault.isError) {
    return (
      <div className={styles.window}>
        <p className={styles.status}>
          core not answering · {vault.error.message}
        </p>
      </div>
    );
  }

  if (vault.data === null) {
    return (
      <div className={styles.window}>
        <FirstRun />
      </div>
    );
  }

  return (
    <VaultChangedListeners value={listeners}>
      <div className={styles.window}>
        <TitleBar title={vault.data.name} />
        <div className={styles.panes}>
          <Sidebar route={route} />
          {route.surface === "inbox" && (
            <Inbox
              landed={landed}
              arrivedOn={route.question ?? null}
              unresolved={route.unresolved ?? null}
              vaultPath={vault.data.path}
            />
          )}
          {route.surface === "research-question" && (
            <ResearchQuestion
              key={route.path}
              path={route.path}
              attachOnArrival={attachOnArrival === route.path}
              onArrival={() => setAttachOnArrival(null)}
            />
          )}
          {route.surface === "hypothesis" && (
            <Hypothesis key={route.path} path={route.path} />
          )}
          {route.surface === "experiment" && (
            <Experiment key={route.path} path={route.path} />
          )}
          {route.surface === "experiments" && <Experiments />}
          {route.surface === "loose-ends" && (
            <LooseEnds
              onAttach={(path) => {
                setAttachOnArrival(path);
                pushRoute({ surface: "research-question", path });
              }}
            />
          )}
        </div>
        <CaptureLine provenance={provenance} onCaptured={onCaptured} />
        {/* Both chords are mounted here and nowhere else, so neither is
            live before a vault is open, and both are handed the same
            Provenance and the same landing (ADR 0027 decision 1). */}
        <GlobalCommand
          route={route}
          provenance={provenance}
          onCaptured={onCaptured}
        />
      </div>
    </VaultChangedListeners>
  );
}
