/**
 * Where a Provider's key lives (ADR 0017 decision 4; `docs/architecture.md`
 * § BYOK and watched sources). There is `get`, `set` and `delete` per
 * provider id and **no RPC that reads one back**: the key is fetched from
 * the store at each run and handed to the one call that needs it, never held
 * between runs. The real store over the macOS Keychain is a later ticket's;
 * this one is what tests, and a core started with no Keychain, use.
 */
export type CredentialStore = {
  get: (provider: string) => Promise<string | null>;
  set: (provider: string, key: string) => Promise<void>;
  delete: (provider: string) => Promise<void>;
};

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
