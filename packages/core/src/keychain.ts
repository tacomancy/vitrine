import { AsyncEntry } from "@napi-rs/keyring";
import { CredentialFault, type CredentialStore } from "./credentials.js";

/**
 * The real store, over the macOS login Keychain: one item per Provider,
 * service `Vitrine`, account the provider id (`docs/architecture.md` § BYOK
 * and watched sources). It lives apart from `credentials.ts` so that only a
 * core started for real loads the native binary.
 *
 * An entry is made per call and dropped, so what is read is always what the
 * Keychain holds now: a removal made in Keychain Access is the next run's
 * answer, with no restart.
 */

/** The part of `AsyncEntry` the store uses; a test stands one in. */
export type KeyEntry = Pick<
  AsyncEntry,
  "getPassword" | "setPassword" | "deleteCredential"
>;

export function createKeychainCredentialStore(
  options: {
    service?: string;
    entry?: (service: string, account: string) => KeyEntry;
  } = {}
): CredentialStore {
  const service = options.service ?? "Vitrine";
  const entryFor = options.entry ?? ((s, a) => new AsyncEntry(s, a));
  // Every failure of the Keychain is the one fault. What the platform said
  // is dropped, not passed on: it can name a path, and a fault never does.
  const guarded = async <T>(
    provider: string,
    act: (entry: KeyEntry) => Promise<T>
  ): Promise<T> => {
    try {
      return await act(entryFor(service, provider));
    } catch {
      throw new CredentialFault();
    }
  };
  return {
    // `undefined` is "no such item"; a locked Keychain rejects instead.
    get: (provider) =>
      guarded(provider, async (e) => (await e.getPassword()) ?? null),
    set: (provider, key) => guarded(provider, (e) => e.setPassword(key)),
    // `false` is "nothing to delete", which leaves the state the caller wanted.
    delete: (provider) =>
      guarded(provider, async (e) => {
        await e.deleteCredential();
      }),
  };
}
