import { useQuery } from "@tanstack/react-query";
import styles from "./App.module.css";
import { FirstRun } from "./FirstRun";
import { Inbox } from "./Inbox";
import { Sidebar } from "./Sidebar";
import { TitleBar } from "./TitleBar";
import { useTRPC } from "./trpc";

export function App() {
  const trpc = useTRPC();
  const vault = useQuery(trpc.vault.current.queryOptions());

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
        <Inbox />
      </div>
    </div>
  );
}
