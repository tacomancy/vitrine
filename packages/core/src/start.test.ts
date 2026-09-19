import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startCore, type RunningCore } from "./start.js";

let running: RunningCore | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

describe("startCore", () => {
  it("listens on 127.0.0.1 at an OS-assigned port with a freshly minted token", async () => {
    running = await startCore();
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
    running = await startCore({ staticDir: dir });

    const res = await fetch(`http://127.0.0.1:${running.port}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>x</title>");
  });

  it("serves the bundle with a same-origin content security policy", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vitrine-bundle-"));
    await writeFile(join(dir, "index.html"), "<!doctype html>");
    running = await startCore({ staticDir: dir });

    const res = await fetch(`http://127.0.0.1:${running.port}/`);
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'self'; img-src 'self' data:"
    );
  });
});
