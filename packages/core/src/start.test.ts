import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPdfEngine } from "./pdf-engine.js";
import { fixtures, vaultWith } from "./test-core.js";
import { startCore, type RunningCore } from "./start.js";

let running: RunningCore | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

// Never the real Application Support folder from a test.
async function support() {
  return { appSupportDir: await mkdtemp(join(tmpdir(), "vitrine-support-")) };
}

describe("startCore", () => {
  it("listens on 127.0.0.1 at an OS-assigned port with a freshly minted token", async () => {
    running = await startCore(await support());
    expect(running.port).toBeGreaterThan(0);
    expect(running.token.length).toBeGreaterThanOrEqual(32);

    const res = await fetch(`http://127.0.0.1:${running.port}/trpc/health`, {
      headers: { authorization: `Bearer ${running.token}` },
    });
    expect(res.status).toBe(200);
  });

  it("serves the renderer bundle at / without a token", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vitrine-bundle-"));
    await writeFile(join(dir, "index.html"), "<!doctype html><title>x</title>");
    running = await startCore({ staticDir: dir, ...(await support()) });

    const res = await fetch(`http://127.0.0.1:${running.port}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>x</title>");
  });

  // The shell waits on this close before it quits (#276), and
  // `events.subscribe` is a subscription that ends only when its client
  // does — so a close that drained its connections instead of dropping
  // them would never resolve, and every quit would wait out the whole
  // bound. This test hangs rather than fails if that regresses.
  it("closes with a subscription still open", async () => {
    running = await startCore(await support());
    const reading = new AbortController();
    const stream = await fetch(
      `http://127.0.0.1:${running.port}/trpc/events.subscribe`,
      {
        headers: {
          authorization: `Bearer ${running.token}`,
          accept: "text/event-stream",
        },
        signal: reading.signal,
      }
    );
    expect(stream.status).toBe(200);

    await running.close();
    running = undefined;
    reading.abort();
  });

  it("serves the bundle with a same-origin content security policy", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vitrine-bundle-"));
    await writeFile(join(dir, "index.html"), "<!doctype html>");
    running = await startCore({ staticDir: dir, ...(await support()) });

    const res = await fetch(`http://127.0.0.1:${running.port}/`);
    // `blob:` for images and nothing else: an Artifact is drawn from an
    // object URL, since an `<img>` cannot carry the bearer header (#366).
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'self'; img-src 'self' data: blob:; worker-src 'self'"
    );
  });

  // The shell's `VITRINE_AUTHOR` reaches the core as this option (#441). The
  // test goes through the real listener and a real highlight, so a dropped
  // hop between `startCore` and `Ingest.highlight` shows as the wrong `/T`.
  it("writes a highlight's /T from the author it was started with", async () => {
    const pdf = "sources/pdf/rasch2013.pdf";
    const vault = await vaultWith({
      "sources/rasch2013.md": `---
kind: source
id: src-1
citekey: rasch2013
title: Odor cues during slow-wave sleep
pdf: rasch2013.pdf
---
`,
    });
    await mkdir(join(vault, "sources/pdf"), { recursive: true });
    await copyFile(
      join(fixtures, "pdf", "synthetic-body.pdf"),
      join(vault, pdf)
    );
    running = await startCore({ ...(await support()), author: "Sarah Lehman" });
    const call = async (path: string, body?: unknown) => {
      const res = await fetch(
        `http://127.0.0.1:${running!.port}/trpc/${path}`,
        {
          method: body === undefined ? "GET" : "POST",
          headers: {
            authorization: `Bearer ${running!.token}`,
            "content-type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }
      );
      return (await res.json()) as {
        error?: { message: string };
        result?: { data: { current: { ok: boolean } } };
      };
    };
    expect((await call("vault.open", { path: vault })).error).toBeUndefined();
    // The index builds after the open answers, and a highlight sent before
    // the Source is indexed is refused. Waiting on the status, not retrying
    // the highlight, keeps a real refusal visible instead of retried away.
    for (let n = 0; n < 100; n++) {
      if ((await call("vault.status")).result?.data.current.ok) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    const reply = await call("sources.highlight", {
      path: "sources/rasch2013.md",
      page: 1,
      rects: [[60, 678, 560, 696]],
      colour: "green",
      note: "",
    });
    expect(reply.error?.message).toBeUndefined();

    const engine = createPdfEngine();
    try {
      const read = await engine.annotations(
        new Uint8Array(await readFile(join(vault, pdf)))
      );
      expect(read.annotations[0]?.author).toBe("Sarah Lehman");
    } finally {
      await engine.close();
    }
  });
});
