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

describe("reading annotations", () => {
  it("reads each markup and note with its quote from the file's own characters", async () => {
    const read = await engine().annotations(await fixture("annotated.pdf"));
    expect(read.pages).toBe(2);
    const marks = read.annotations.filter((a) => a.kind !== "ink");
    expect(marks.map((a) => [a.kind, a.page, a.quote, a.note]).sort()).toEqual(
      [
        [
          "highlight",
          0,
          "Participants who heard the odor cue",
          "Check this against the control group",
        ],
        [
          "highlight",
          0,
          "difference was reliable across the downstream analyses",
          "",
        ],
        ["highlight", 1, "different sentence about memory", ""],
        // A sticky note's text is its own quote; it has no passage.
        ["text", 0, "Ask Ana about this", ""],
        ["stamp", 1, "", ""],
      ].sort()
    );
  });

  it("keeps the quads as the file wrote them, one per line of a highlight", async () => {
    const read = await engine().annotations(await fixture("annotated.pdf"));
    const across = read.annotations.find((a) =>
      a.quote.startsWith("difference was")
    )!;
    expect(across.quads).toHaveLength(2);
    expect(across.quads.every((q) => q.length === 8)).toBe(true);
  });

  it("names ink and a stamp by kind and gives neither a quote", async () => {
    const read = await engine().annotations(await fixture("annotated.pdf"));
    const kinds = read.annotations.map((a) => a.kind).sort();
    expect(kinds).toContain("ink");
    expect(kinds).toContain("stamp");
    for (const a of read.annotations.filter((x) =>
      ["ink", "stamp"].includes(x.kind)
    )) {
      expect(a.quote).toBe("");
    }
  });

  it("answers an unannotated file with none", async () => {
    const read = await engine().annotations(
      await fixture("synthetic-body.pdf")
    );
    expect(read).toMatchObject({ pages: 2, annotations: [] });
  });

  it("names a file it cannot read as it does for metadata", async () => {
    expect(
      await failure(engine().annotations(Buffer.from("just some words")))
    ).toBe("it is damaged, or is not a PDF");
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
