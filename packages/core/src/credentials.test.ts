import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CredentialFault,
  createMemoryCredentialStore,
  type CredentialStore,
} from "./credentials.js";
import { ModelError, type ModelProvider } from "./model-provider.js";
import { closeCores, core, tmp } from "./test-core.js";

afterEach(closeCores);

// `credentials.status | set | delete | test` (#465; ADR 0017 decision 4):
// there is no `get`, so every assertion is on what the procedures answer and
// on what the store holds, and one asserts that nothing answers with the key.

const KEY = "sk-ant-secret-1234567890";

type Status =
  { state: "present" | "absent" } | { state: "fault"; reason: string };

function models(
  count: ModelProvider["countTokens"] = () => Promise.resolve(8)
): ModelProvider {
  return {
    countTokens: count,
    extract: () => Promise.reject(new Error("not called")),
  };
}

async function started(
  options: {
    store?: CredentialStore;
    models?: ModelProvider;
    appSupportDir?: string;
  } = {}
) {
  const store = options.store ?? createMemoryCredentialStore();
  const c = await core({
    ...(options.appSupportDir ? { appSupportDir: options.appSupportDir } : {}),
    watched: { credentials: store, models: options.models ?? models() },
  });
  const status = async () =>
    (await c.query<Status>("credentials.status", { provider: "anthropic" }))
      .result?.data;
  return { c, store, status };
}

describe("credentials.status | set | delete", () => {
  it("reflects setting, replacing and removing a key", async () => {
    const { c, store, status } = await started();
    expect(await status()).toEqual({ state: "absent" });

    await c.mutate("credentials.set", { provider: "anthropic", key: KEY });
    expect(await status()).toEqual({ state: "present" });
    expect(await store.get("anthropic")).toBe(KEY);

    await c.mutate("credentials.set", { provider: "anthropic", key: "sk-two" });
    expect(await store.get("anthropic")).toBe("sk-two");

    await c.mutate("credentials.delete", { provider: "anthropic" });
    expect(await status()).toEqual({ state: "absent" });
  });

  it("answers nothing that contains the key", async () => {
    const { c } = await started();
    const replies = [
      await c.mutate("credentials.set", { provider: "anthropic", key: KEY }),
      await c.query("credentials.status", { provider: "anthropic" }),
      await c.mutate("credentials.test", { provider: "anthropic" }),
      await c.query("credentials.model", { provider: "anthropic" }),
    ];
    expect(JSON.stringify(replies)).not.toContain(KEY);
  });

  it("has no procedure that reads a key back", async () => {
    const { c } = await started();
    const get = await c.query("credentials.get", { provider: "anthropic" });
    expect(get.error).toBeDefined();
    expect(get.result).toBeUndefined();
  });

  it("refuses an empty key and a provider it does not know", async () => {
    const { c, store } = await started();
    expect(
      (await c.mutate("credentials.set", { provider: "anthropic", key: "  " }))
        .error
    ).toBeDefined();
    expect(
      (await c.mutate("credentials.set", { provider: "openai", key: KEY }))
        .error
    ).toBeDefined();
    expect(await store.get("anthropic")).toBeNull();
  });

  it("states a Keychain fault as one, never as no key", async () => {
    const refused: CredentialStore = {
      get: () => Promise.reject(new CredentialFault()),
      set: () => Promise.reject(new CredentialFault()),
      delete: () => Promise.reject(new CredentialFault()),
    };
    const { c, status } = await started({ store: refused });
    const read = await status();
    expect(read?.state).toBe("fault");
    expect(JSON.stringify(read)).toMatch(/Keychain/);

    const set = await c.mutate("credentials.set", {
      provider: "anthropic",
      key: KEY,
    });
    expect(set.error?.message).toMatch(/Keychain/);
  });

  it("sees a removal made outside the app on the next read, with no restart", async () => {
    const { c, store, status } = await started();
    await c.mutate("credentials.set", { provider: "anthropic", key: KEY });
    expect(await status()).toEqual({ state: "present" });
    await store.delete("anthropic"); // Keychain Access
    expect(await status()).toEqual({ state: "absent" });
  });
});

describe("credentials.test", () => {
  const test = async (c: Awaited<ReturnType<typeof started>>["c"]) =>
    (
      await c.mutate<{ result: string }>("credentials.test", {
        provider: "anthropic",
      })
    ).result?.data;

  it("says ok when the one minimal call is answered", async () => {
    const seen: Array<{ key: string; model: string }> = [];
    const { c } = await started({
      models: models((req) => {
        seen.push({ key: req.key, model: req.model });
        return Promise.resolve(8);
      }),
    });
    await c.mutate("credentials.set", { provider: "anthropic", key: KEY });
    expect(await test(c)).toEqual({ result: "ok" });
    expect(seen).toEqual([{ key: KEY, model: "claude-opus-5" }]);
  });

  it("says no key without calling the provider", async () => {
    let calls = 0;
    const { c } = await started({
      models: models(() => {
        calls++;
        return Promise.resolve(1);
      }),
    });
    expect(await test(c)).toEqual({ result: "no-key" });
    expect(calls).toBe(0);
  });

  it("says key rejected on a refused key", async () => {
    const { c } = await started({
      models: models(() =>
        Promise.reject(new ModelError("credentials", "key rejected"))
      ),
    });
    await c.mutate("credentials.set", { provider: "anthropic", key: KEY });
    expect(await test(c)).toEqual({ result: "rejected" });
  });

  it("says the provider could not be reached on any other failure", async () => {
    const { c } = await started({
      models: models(() =>
        Promise.reject(
          new ModelError("model", "the provider could not be reached")
        )
      ),
    });
    await c.mutate("credentials.set", { provider: "anthropic", key: KEY });
    expect(await test(c)).toEqual({ result: "unreachable" });
  });

  it("says a locked Keychain is a fault", async () => {
    const { c } = await started({
      store: {
        get: () => Promise.reject(new CredentialFault()),
        set: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      },
    });
    expect(await test(c)).toMatchObject({ result: "fault" });
  });
});

describe("the model id", () => {
  it("defaults to the model the app was designed against", async () => {
    const { c } = await started();
    expect(
      (
        await c.query<{ model: string }>("credentials.model", {
          provider: "anthropic",
        })
      ).result?.data
    ).toEqual({ model: "claude-opus-5" });
  });

  it("is stored in providers.json beside the core's state, never with the key", async () => {
    const dir = await tmp("providers");
    const { c } = await started({ appSupportDir: dir });
    await c.mutate("credentials.set", { provider: "anthropic", key: KEY });
    await c.mutate("credentials.setModel", {
      provider: "anthropic",
      model: " claude-sonnet-5 ",
    });
    const file = await readFile(join(dir, "providers.json"), "utf8");
    expect(JSON.parse(file)).toEqual({
      anthropic: { model: "claude-sonnet-5" },
    });
    expect(file).not.toContain(KEY);
    expect(
      (
        await c.query<{ model: string }>("credentials.model", {
          provider: "anthropic",
        })
      ).result?.data
    ).toEqual({ model: "claude-sonnet-5" });
  });

  it("reaches the next call, with no restart", async () => {
    const used: string[] = [];
    const { c } = await started({
      models: models((req) => {
        used.push(req.model);
        return Promise.resolve(1);
      }),
    });
    await c.mutate("credentials.set", { provider: "anthropic", key: KEY });
    await c.mutate("credentials.setModel", {
      provider: "anthropic",
      model: "claude-haiku-4-5",
    });
    await c.mutate("credentials.test", { provider: "anthropic" });
    expect(used).toEqual(["claude-haiku-4-5"]);
  });

  it("falls back to the default when providers.json is unreadable, and refuses a blank id", async () => {
    const dir = await tmp("providers");
    await writeFile(join(dir, "providers.json"), "{ not json");
    const { c } = await started({ appSupportDir: dir });
    expect(
      (
        await c.query<{ model: string }>("credentials.model", {
          provider: "anthropic",
        })
      ).result?.data
    ).toEqual({ model: "claude-opus-5" });
    expect(
      (
        await c.mutate("credentials.setModel", {
          provider: "anthropic",
          model: " ",
        })
      ).error
    ).toBeDefined();
  });
});
