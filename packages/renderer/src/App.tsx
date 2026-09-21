import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Question } from "core";
import { useState } from "react";
import styles from "./App.module.css";
import { CaptureLine } from "./CaptureLine";
import { useCoreEvents } from "./events";
import { FirstRun } from "./FirstRun";
import { Inbox } from "./Inbox";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";
import { useTRPC } from "./trpc";

export function App() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const vault = useQuery(trpc.vault.current.queryOptions());
  useCoreEvents();
  // The last Question the capture line wrote. The Inbox re-reads the vault
  // and makes it the selection, so the user sees it land (brief § Question
  // Inbox: "everything captured recently, newest first").
  const [landed, setLanded] = useState<Question | null>(null);

  const onCaptured = (question: Question) => {
    void queryClient.invalidateQueries(trpc.questions.list.pathFilter());
    setLanded(question);
  };

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
    <div className={styles.window}>
      <TitleBar title={vault.data.name} />
      <div className={styles.panes}>
        <Sidebar />
        <Inbox landed={landed} />
      </div>
      <CaptureLine onCaptured={onCaptured} />
    </div>
  );
}
