import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Provenance, Question } from "core";
import { useState } from "react";
import styles from "./App.module.css";
import { CaptureLine } from "./CaptureLine";
import { useCoreEvents, VaultChangedListeners } from "./events";
import { FirstRun } from "./FirstRun";
import { Inbox } from "./Inbox";
import { LooseEnds } from "./LooseEnds";
import { ResearchQuestion } from "./ResearchQuestion";
import { useRoute } from "./router";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";
import { useTRPC } from "./trpc";

export function App() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const vault = useQuery(trpc.vault.current.queryOptions());
  const listeners = useCoreEvents();
  const route = useRoute();
  // The last Question the capture line wrote. The Inbox re-reads the vault
  // and makes it the selection, so the user sees it land (brief § Question
  // Inbox: "everything captured recently, newest first").
  const [landed, setLanded] = useState<Question | null>(null);

  const onCaptured = (question: Question) => {
    void queryClient.invalidateQueries(trpc.questions.list.pathFilter());
    // A capture made on a page appended its link there (§ Vault layout).
    void queryClient.invalidateQueries(
      trpc.researchQuestions.page.pathFilter()
    );
    setLanded(question);
  };

  // What the capture line records as Provenance (CONTEXT.md): pursuing the
  // page at this address, otherwise Unattached. The address names a file,
  // not a Kind; a capture on a page that is not a Research Question is
  // refused by the core, loudly, in the capture line. The Reader will add
  // *reading* here when it exists.
  const provenance: Provenance =
    route.surface === "questions"
      ? { context: "pursuing", researchQuestion: route.path }
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
            <Inbox landed={landed} vaultPath={vault.data.path} />
          )}
          {route.surface === "questions" && (
            <ResearchQuestion key={route.path} path={route.path} />
          )}
          {route.surface === "loose-ends" && <LooseEnds />}
        </div>
        <CaptureLine provenance={provenance} onCaptured={onCaptured} />
      </div>
    </VaultChangedListeners>
  );
}
