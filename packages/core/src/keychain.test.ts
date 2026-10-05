import { describe, expect, it } from "vitest";
import { CredentialFault } from "./credentials.js";
import { createKeychainCredentialStore, type KeyEntry } from "./keychain.js";

// The Keychain-backed store over a stand-in for `AsyncEntry`: the real one is
// exercised by the opt-in live test, and everything the store decides — that
// an item that is not there is `null`, that a refusal is a fault and never
// `null`, that nothing is held between calls — is decided here.

function fakeKeychain(options: { locked?: boolean } = {}) {
  const items = new Map<string, string>();
  const made: string[] = [];
  const refuse = () =>
    Promise.reject(new Error("User interaction is not allowed."));
  const entry = (service: string, account: string): KeyEntry => {
    made.push(`${service}/${account}`);
    const at = `${service}/${account}`;
    return {
      getPassword: () =>
        options.locked ? refuse() : Promise.resolve(items.get(at)),
      setPassword: (key) => {
        if (options.locked) return refuse();
        items.set(at, key);
        return Promise.resolve();
      },
      deleteCredential: () => {
        if (options.locked) return refuse();
        return Promise.resolve(items.delete(at));
      },
    };
  };
  return { items, made, entry };
}

describe("the Keychain credential store", () => {
  it("keeps one item per provider under the service Vitrine", async () => {
    const k = fakeKeychain();
    const store = createKeychainCredentialStore({ entry: k.entry });
    await store.set("anthropic", "sk-one");
    expect(k.items.get("Vitrine/anthropic")).toBe("sk-one");
    expect(await store.get("anthropic")).toBe("sk-one");
  });

  it("answers null for an item that is not there, and for a removed one", async () => {
    const store = createKeychainCredentialStore({
      entry: fakeKeychain().entry,
    });
    expect(await store.get("anthropic")).toBeNull();
    await store.set("anthropic", "sk-one");
    await store.delete("anthropic");
    expect(await store.get("anthropic")).toBeNull();
    // Deleting what is not there is not an error: the outcome is the same.
    await expect(store.delete("anthropic")).resolves.toBeUndefined();
  });

  it("reads the Keychain at each call, so a removal made outside shows at once", async () => {
    const k = fakeKeychain();
    const store = createKeychainCredentialStore({ entry: k.entry });
    await store.set("anthropic", "sk-one");
    expect(await store.get("anthropic")).toBe("sk-one");
    k.items.clear(); // Keychain Access
    expect(await store.get("anthropic")).toBeNull();
  });

  it("says a refused Keychain is a fault, never no key", async () => {
    const store = createKeychainCredentialStore({
      entry: fakeKeychain({ locked: true }).entry,
    });
    await expect(store.get("anthropic")).rejects.toBeInstanceOf(
      CredentialFault
    );
    await expect(store.set("anthropic", "k")).rejects.toBeInstanceOf(
      CredentialFault
    );
    await expect(store.delete("anthropic")).rejects.toBeInstanceOf(
      CredentialFault
    );
  });

  it("words the fault without the platform's message or a path", async () => {
    const store = createKeychainCredentialStore({
      entry: fakeKeychain({ locked: true }).entry,
    });
    const fault = await store.get("anthropic").catch((e: Error) => e);
    expect((fault as Error).message).not.toMatch(/interaction|\//);
    expect((fault as Error).message).toMatch(/Keychain/);
  });
});
