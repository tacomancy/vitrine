import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const token = "test-token";

describe("core HTTP app", () => {
  it("answers health through the router when the bearer token is present", async () => {
    const app = createApp({ token });
    const res = await app.request("/trpc/health", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { data: unknown } };
    expect(body.result.data).toEqual({ ok: true });
  });

  it("rejects a request with no token before any router code runs", async () => {
    const app = createApp({ token });
    const res = await app.request("/trpc/health");
    expect(res.status).toBe(401);
  });
});
