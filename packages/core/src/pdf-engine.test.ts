import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPdfEngine,
  PdfUnreadable,
  type PdfEngine,
} from "./pdf-engine.js";
import { fixtures } from "./test-core.js";

// The engine is the one place a PDF is read (#418; ADR 0007): what it hands
// back is the file's own metadata, and a file it cannot read is a plain
// reason, never a crash.

const engines: PdfEngine[] = [];
const engine = (options?: Parameters<typeof createPdfEngine>[0]) => {
  const made = createPdfEngine(options);
  engines.push(made);
  return made;
};
afterEach(async () => {
  for (const e of engines.splice(0)) await e.close();
});

const fixture = (name: string) => readFile(join(fixtures, "pdf", name));
const failure = async (work: Promise<unknown>) => {
  const error: unknown = await work.then(
    () => undefined,
    (cause: unknown) => cause
  );
  expect(error).toBeInstanceOf(PdfUnreadable);
  return (error as PdfUnreadable).reason;
};

describe("reading metadata", () => {
  it("reads title and author from the Info fields", async () => {
    expect(
      await engine().metadata(await fixture("synthetic-info.pdf"))
    ).toEqual({
      title: "Odor cues and the invented night",
      author: "Jens G. Klinzing; Jan Born",
    });
  });

  it("leaves out a field the file does not carry", async () => {
    expect(
      await engine().metadata(await fixture("synthetic-no-title.pdf"))
    ).toEqual({ author: "Ana Reyes" });
    expect(
      await engine().metadata(await fixture("synthetic-no-info.pdf"))
    ).toEqual({});
  });

  it("reads a file PDFKit saved", async () => {
    expect(await engine().metadata(await fixture("pdfkit-saved.pdf"))).toEqual({
      title: "Odor cues and the invented night",
      author: "Jens G. Klinzing; Jan Born",
    });
  });
});

describe("a file it cannot read", () => {
  it("names a password-protected one without a path", async () => {
    const reason = await failure(
      engine().metadata(await fixture("encrypted.pdf"))
    );
    expect(reason).toBe("it is protected by a password");
  });

  it("names a damaged one, and reads the next file", async () => {
    const e = engine();
    const good = await fixture("synthetic-info.pdf");
    const reason = await failure(e.metadata(good.subarray(0, 40)));
    expect(reason).toBe("it is damaged, or is not a PDF");
    expect((await e.metadata(good)).title).toBe(
      "Odor cues and the invented night"
    );
  });

  it("says a file that is not a PDF is not one", async () => {
    expect(
      await failure(engine().metadata(Buffer.from("just some words")))
    ).toBe("it is damaged, or is not a PDF");
  });
});

describe("a worker that traps", () => {
  const trapping = () =>
    engine({
      workerUrl: new URL("./pdf-engine.trap.worker.ts", import.meta.url),
    });

  it("reports that one file as unreadable and starts a fresh worker for the next", async () => {
    const e = trapping();
    expect(await failure(e.metadata(Buffer.from("TRAP")))).toBe(
      "the reader stopped on it"
    );
    expect(await e.metadata(Buffer.from("fine"))).toEqual({ title: "alive" });
  });

  it("does not retry a trapped file on its own", async () => {
    const e = trapping();
    const worker = e.metadata(Buffer.from("TRAP"));
    await failure(worker);
    // One job in, one out: the engine asked nothing more of the file, so
    // the next answer is for the next file's job and no other.
    expect(await e.metadata(Buffer.from("next"))).toEqual({ title: "alive" });
  });

  it("answers jobs queued behind the trapped one", async () => {
    const e = trapping();
    const [first, second, third] = await Promise.allSettled([
      e.metadata(Buffer.from("one")),
      e.metadata(Buffer.from("TRAP")),
      e.metadata(Buffer.from("three")),
    ]);
    expect(first.status).toBe("fulfilled");
    expect(second.status).toBe("rejected");
    expect(third.status).toBe("fulfilled");
  });
});
