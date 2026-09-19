import { useQuery } from "@tanstack/react-query";
import styles from "./App.module.css";
import { TitleBar } from "./TitleBar";
import { useTRPC } from "./trpc";

export function App({ port }: { port: number }) {
  const trpc = useTRPC();
  const health = useQuery(trpc.health.queryOptions());

  let status: string;
  if (health.isPending) status = "core · connecting";
  else if (health.isError)
    status = `core not answering · ${health.error.message}`;
  else status = `core answering on 127.0.0.1:${port}`;

  return (
    <div className={styles.window}>
      <TitleBar title="Vitrine" />
      <main className={styles.main}>
        <p className={styles.status}>{status}</p>
      </main>
    </div>
  );
}
