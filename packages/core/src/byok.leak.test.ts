import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryCredentialStore } from "./credentials.js";
import { createAnthropicProvider, PROVIDER_ORIGIN } from "./model-provider.js";
import { router } from "./router.js";
import {
  closeCores,
  core,
  fixtureCopy,
  tmp,
  urlOf,
  virtualClock,
} from "./test-core.js";

afterEach(() => {
  vi.restoreAllMocks();
  return closeCores();
});

// Issue #749, the whole-flow half of the BYOK audit: a Scout run and every
// Credentials panel flow, against the real provider code and a request
// recorder, then a search of everything the app says or keeps for the key.

const KEY = "sk-ant-api03-LEAKCHECK-0123456789";
const PREFIX = KEY.slice(0, 16);
const LAB = "https://lab.example/publications";
const PAGE =
  '<html><body><h1>Papers</h1><p>Sleep Spindles Predict Next-Day Learning</p><a href="https://lab.example/p/1">link</a></body></html>';

const hasKey = (text: string) => text.includes(PREFIX);

async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(path)));
    else out.push(path);
  }
  return out;
}

function dump(path: string): string {
  const handle = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = handle
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    return tables
      .map(({ name }) =>
        JSON.stringify(handle.prepare(`SELECT * FROM "${name}"`).all())
      )
      .join("\n");
  } finally {
    handle.close();
  }
}

describe("where the key goes", () => {
  it("is in exactly the provider's requests and in nothing the app says or keeps", async () => {
    const vault = await fixtureCopy("obsidian-vault");
    const appSupportDir = await tmp("byok-support");
    await mkdir(join(vault, ".vitrine/scouts"), { recursive: true });
    await writeFile(
      join(vault, ".vitrine/scouts/lab.yaml"),
      `name: Lab\nsource:\n  kind: watched\n  url: ${LAB}\ncadence: weekly\nlane: review\ncreated: 2026-09-20T00:00:00Z\n`
    );

    const providerSeen: Array<{ url: string; key: string | null }> = [];
    const otherSeen: Array<{ url: string; carriesKey: boolean }> = [];
    let answer: "ok" | "rejected" = "ok";
    const providerFetch = ((
      input: Request | URL | string,
      init?: RequestInit
    ) => {
      const url = input instanceof Request ? input.url : String(input);
      providerSeen.push({
        url,
        key: new Headers(init?.headers).get("x-api-key"),
      });
      if (url.includes("count_tokens")) {
        return Promise.resolve(Response.json({ input_tokens: 1 }));
      }
      if (answer === "rejected") {
        return Promise.resolve(
          Response.json(
            {
              type: "error",
              error: { type: "authentication_error", message: "bad" },
            },
            { status: 401 }
          )
        );
      }
      return Promise.resolve(
        Response.json({
          id: "m",
          type: "message",
          role: "assistant",
          model: "m",
          stop_reason: "end_turn",
          content: [{ type: "text", text: '{"items": []}' }],
          usage: { input_tokens: 5, output_tokens: 2 },
        })
      );
    }) as typeof fetch;

    const logged: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      });
    }

    const replies: unknown[] = [];
    const c = await core({
      appSupportDir,
      arxiv: {
        clock: virtualClock(),
        fetch: () => Promise.resolve(new Response("")),
      },
      watched: {
        credentials: createMemoryCredentialStore(),
        models: createAnthropicProvider(undefined, providerFetch),
        fetch: (input, init) => {
          otherSeen.push({
            url: urlOf(input).href,
            carriesKey: [...new Headers(init?.headers).values()].some(hasKey),
          });
          return Promise.resolve(
            new Response(urlOf(input).pathname === "/robots.txt" ? "" : PAGE, {
              status: urlOf(input).pathname === "/robots.txt" ? 404 : 200,
              headers: { "content-type": "text/html" },
            })
          );
        },
      },
    });
    await c.mutate("vault.open", { path: vault });
    await c.indexed();

    replies.push(
      await c.mutate("credentials.set", { provider: "anthropic", key: KEY }),
      await c.query("credentials.status", { provider: "anthropic" }),
      await c.mutate("credentials.test", { provider: "anthropic" }),
      await c.mutate("credentials.setModel", {
        provider: "anthropic",
        model: "claude-opus-5",
      }),
      await c.query("credentials.model", { provider: "anthropic" }),
      await c.mutate("scouts.runNow", { scoutId: "lab" })
    );
    answer = "rejected";
    replies.push(
      await c.mutate("scouts.runNow", { scoutId: "lab" }),
      await c.query("scouts.list"),
      await c.query("scouts.queue", { sort: "newest" }),
      await c.mutate("credentials.delete", { provider: "anthropic" })
    );

    // Exactly the provider's host got the key, and every request that carried it.
    expect(providerSeen.length).toBeGreaterThanOrEqual(3);
    for (const request of providerSeen) {
      expect(new URL(request.url).origin).toBe(PROVIDER_ORIGIN);
      expect(request.key).toBe(KEY);
    }
    // The page fetches, robots.txt included, never saw it.
    expect(otherSeen.length).toBeGreaterThan(0);
    expect(otherSeen.filter((r) => r.carriesKey)).toEqual([]);

    // Nothing the core answered, logged, or wrote contains it.
    expect(hasKey(JSON.stringify(replies))).toBe(false);
    expect(logged.filter(hasKey)).toEqual([]);
    for (const dir of [vault, appSupportDir]) {
      for (const path of await filesUnder(dir)) {
        const bytes = await readFile(path);
        if (path.endsWith(".sqlite")) {
          expect(hasKey(dump(path)), path).toBe(false);
        }
        expect(hasKey(bytes.toString("latin1")), path).toBe(false);
      }
    }
  });
});

describe("the RPC surface", () => {
  it("has no procedure that reads a key back", () => {
    const names = Object.keys(
      (router as unknown as { _def: { procedures: object } })._def.procedures
    );
    expect(names).toContain("credentials.status");
    const credentials = names.filter((n) => n.startsWith("credentials."));
    expect(credentials.sort()).toEqual([
      "credentials.delete",
      "credentials.model",
      "credentials.set",
      "credentials.setModel",
      "credentials.status",
      "credentials.test",
      "credentials.waiting",
    ]);
    // Pinned by name above for credentials; elsewhere, nothing named for the secret.
    expect(names.filter((n) => /\b(key|secret|token)s?$/i.test(n))).toEqual([]);
  });
});
