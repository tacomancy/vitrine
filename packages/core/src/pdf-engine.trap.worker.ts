// A stand-in for the engine's worker that dies on a file starting `TRAP`
// (`pdf-engine.test.ts`): a real file that traps PDFium is not something to
// commit, and what the core must survive is the worker going, not why.
import { parentPort } from "node:worker_threads";

parentPort?.on(
  "message",
  ({ id, bytes }: { id: number; bytes: Uint8Array }) => {
    if (Buffer.from(bytes).toString("latin1").startsWith("TRAP")) {
      process.exit(1);
    }
    parentPort?.postMessage({ id, result: { title: "alive" } });
  }
);
