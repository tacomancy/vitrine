import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { CredentialFault } from "../src/credentials.js";
import { createKeychainCredentialStore } from "../src/keychain.js";

// The one test that touches the real macOS login Keychain (#465), opt-in
// with the other live tests (`pnpm --filter core test:live`). It uses a
// throwaway service name so it can never read or replace a real Vitrine key,
// and removes what it wrote. A first run may ask for Keychain access.

const service = `Vitrine-live-test-${randomBytes(4).toString("hex")}`;
const store = createKeychainCredentialStore({ service });

afterAll(() => store.delete("anthropic").catch(() => undefined));

describe.skipIf(process.platform !== "darwin")("the real Keychain", () => {
  it("stores, replaces, reads and removes a key, and reads absence as null", async () => {
    expect(await store.get("anthropic")).toBeNull();
    await store.set("anthropic", "sk-live-one");
    expect(await store.get("anthropic")).toBe("sk-live-one");
    await store.set("anthropic", "sk-live-two");
    expect(await store.get("anthropic")).toBe("sk-live-two");
    await store.delete("anthropic");
    expect(await store.get("anthropic")).toBeNull();
    await expect(store.delete("anthropic")).resolves.toBeUndefined();
  });

  it("has CredentialFault to say a refusal with", () => {
    expect(new CredentialFault().message).toMatch(/Keychain/);
  });
});
