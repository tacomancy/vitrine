import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const token = "test-token";
const options = {
  token,
  host: { pickFolder: () => Promise.resolve(null) },
  appSupportDir: await mkdtemp(join(tmpdir(), "vitrine-support-")),
};

describe("core HTTP app", () => {
  it("answers health through the router when the bearer token is present", async () => {
    const { app } = createApp(options);
    const res = await app.request("/trpc/health", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { data: unknown } };
    expect(body.result.data).toEqual({ ok: true });
  });

  it("rejects a request with no token before any router code runs", async () => {
    const { app } = createApp(options);
    const res = await app.request("/trpc/health");
    expect(res.status).toBe(401);
  });
});
