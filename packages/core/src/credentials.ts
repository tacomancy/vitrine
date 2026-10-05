import { ModelError, type ModelProvider } from "./model-provider.js";

/**
 * Where a Provider's key lives (ADR 0017 decision 4; `docs/architecture.md`
 * § BYOK and watched sources). There is `get`, `set` and `delete` per
 * provider id and **no RPC that reads one back**: the key is fetched from
 * the store at each run and handed to the one call that needs it, never held
 * between runs. The real store over the macOS Keychain is `keychain.ts`; the
 * in-memory one below is what tests, and a core built with no Keychain, use.
 */
export type CredentialStore = {
  get: (provider: string) => Promise<string | null>;
  set: (provider: string, key: string) => Promise<void>;
  delete: (provider: string) => Promise<void>;
};

/**
 * The store could not be read or written at all — a locked Keychain, a denied
 * access dialog. It is its own thing and never `null`: a refusal folded into
 * *no key* would send the researcher to enter a key that is already there.
 * The sentence is fixed here, once, and names nothing about the machine.
 */
export class CredentialFault extends Error {
  constructor() {
    super(
      "The Keychain could not be used: it may be locked, or access to the key was refused."
    );
  }
}

export const ANTHROPIC = "anthropic";

export function createMemoryCredentialStore(
  initial: Record<string, string> = {}
): CredentialStore {
  const keys = new Map(Object.entries(initial));
  return {
    get: (provider) => Promise.resolve(keys.get(provider) ?? null),
    set: (provider, key) => {
      keys.set(provider, key);
      return Promise.resolve();
    },
    delete: (provider) => {
      keys.delete(provider);
      return Promise.resolve();
    },
  };
}

/** What `credentials.status` answers: whether a key is stored, never the key. */
export type KeyStatus =
  { state: "present" | "absent" } | { state: "fault"; reason: string };

export async function keyStatus(
  store: CredentialStore,
  provider: string
): Promise<KeyStatus> {
  try {
    return {
      state: (await store.get(provider)) === null ? "absent" : "present",
    };
  } catch (cause) {
    if (cause instanceof CredentialFault) {
      return { state: "fault", reason: cause.message };
    }
    throw cause;
  }
}

/** What `credentials.test` answers. `rejected` and `unreachable` are told apart so the researcher knows whether to fix the key or wait. */
export type KeyTest =
  | { result: "ok" | "no-key" | "rejected" | "unreachable" }
  | { result: "fault"; reason: string };

/**
 * One minimal call — counting the tokens of a single word, which is billed
 * nothing and exercises the key and the model id — with the key fetched from
 * the store for the call and dropped.
 */
export async function testKey(
  store: CredentialStore,
  models: ModelProvider,
  provider: string,
  model: string
): Promise<KeyTest> {
  let key: string | null;
  try {
    key = await store.get(provider);
  } catch (cause) {
    if (cause instanceof CredentialFault) {
      return { result: "fault", reason: cause.message };
    }
    throw cause;
  }
  if (key === null) return { result: "no-key" };
  try {
    await models.countTokens({ key, model, text: "ping" });
    return { result: "ok" };
  } catch (cause) {
    if (cause instanceof ModelError) {
      return {
        result: cause.kind === "credentials" ? "rejected" : "unreachable",
      };
    }
    throw cause;
  }
}
