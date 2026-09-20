# Storing the provider API key from the core — Keychain access from Node

Research for [#135](https://github.com/tacomancy/vitrine/issues/135) (wayfinder, part of #131). Findings only; the decision it feeds becomes an ADR when beat 7 (watched sources + BYOK) is specced. Checked 2026-09-20 against the sources cited inline.

## The constraint

- BYOK: "No credentials leave the device except to the configured provider" (`docs/reference/design-brief.md` § BYOK; `CLAUDE.md` § Invariants). `docs/architecture.md` § Vault layout already says "Credentials in the Keychain".
- The core is an Electron `utilityProcess` (ADR 0005), built with plain `tsc` (`packages/core/package.json`), with no dependency on Electron: `packages/core/src/main.ts` confines everything Electron-specific to the `process.parentPort` channel, and the same code runs under bare `node dist/main.js`. The shell is built with electron-vite (`packages/shell/electron.vite.config.ts`, `externalizeDepsPlugin` on main and preload).
- The Host (`CONTEXT.md` **Host**, `packages/core/src/host.ts`) is today one method, `pickFolder`; the iPad PWA client has no Host.
- Electron is `^44.4.3` (`packages/shell/package.json`; lockfile resolves 44.4.3).

## What a utility process can and cannot do

- A utility process "creates a child process with Node.js and Message ports enabled" and "runs in a Node.js environment, meaning it has the ability to `require` modules and use all of Node.js APIs" — [utilityProcess](https://github.com/electron/electron/blob/44-x-y/docs/api/utility-process.md), [Process model](https://www.electronjs.org/docs/latest/tutorial/process-model).
- The Electron modules it can load are enumerated in [`lib/utility/api/module-list.ts`](https://github.com/electron/electron/blob/44-x-y/lib/utility/api/module-list.ts) on the 44 branch: `net` and `systemPreferences` only. `safeStorage` is in the browser (main) list, not the utility list. So **`safeStorage` is unreachable from the core**; anything using it has to go through the shell.
- Native Node modules load in a utility process like in any Node process. A Node-API module needs no rebuild against Electron: Node-API "is ABI stable across versions of Node.js" ([Node docs](https://github.com/nodejs/node/blob/main/doc/api/n-api.md)); Electron's rebuild guidance ([Using native Node modules](https://github.com/electron/electron/blob/44-x-y/docs/tutorial/using-native-node-modules.md)) applies to modules compiled against V8/Node internals, which is what `keytar` was.

## The candidates

### 1. Electron `safeStorage` (main process only)

Source: [safe-storage.md, 44-x-y](https://github.com/electron/electron/blob/44-x-y/docs/api/safe-storage.md); [code-signing.md § macOS APIs that require code signing](https://github.com/electron/electron/blob/44-x-y/docs/tutorial/code-signing.md).

- "Process: Main". `encryptString(plainText) → Buffer`, `decryptString(Buffer) → string`, `isEncryptionAvailable() → boolean`, plus async variants (`encryptStringAsync`, `decryptStringAsync → { result, shouldReEncrypt }`, `isAsyncEncryptionAvailable`). The 44 doc says "the synchronous API may be deprecated in a future version"; the current `main` doc says the synchronous API "was removed in Electron 46". Write against the async API.
- It is **not a credential store**. On macOS, "encryption keys are stored for your app in Keychain Access"; the *ciphertext* is a `Buffer` the app must persist itself (for Vitrine: a file under `~/Library/Application Support/Vitrine/`, the folder the core already owns). What sits in the Keychain is one per-app key, not the API key.
- "On macOS, access to the system Keychain is required and these calls can block the current thread to collect user input." First use may prompt.
- Signing: "your app should be code signed for `safeStorage` to behave consistently. Without a valid, consistent signature, macOS may not recognize different builds of your app as the same application, which can cause the Keychain to re-prompt the user for permission on every update." Today Vitrine runs from `node_modules/electron`, unsigned as Vitrine; packaging and signing are deferred (ADR 0005).
- `isEncryptionAvailable()` is false on macOS "when Keychain is unavailable" — the app must handle that path explicitly.

What the core ↔ shell protocol would look like: two more Host messages in `packages/core/src/main.ts`, `{ type: "encrypt", id, plainText }` → `{ type: "encrypted", id, bytes }` and `{ type: "decrypt", id, bytes }` → `{ type: "decrypted", id, plainText }`, with the core writing/reading the ciphertext file. Every plaintext key transits the `parentPort` channel (an in-process Mojo pipe, not a socket), and the Host interface grows two methods that exist only to reach a main-process module — the Host's stated purpose is "the things only a desktop shell can do", and encrypting a string is not natively one of them. The core cannot be tested without a Host stub that fakes encryption, and a bare `node dist/main.js` run has no Host and therefore no credential.

### 2. `keytar` — archived

- npm: latest `7.9.0`; repository `atom/node-keytar`; GitHub API reports `"archived": true`, last push 2022-12-12.
- The README says each release "includes prebuilt binaries for the versions of Node and Electron that are actively supported" — a V8-ABI native module that needs a matching prebuilt or a rebuild per Electron major. With no releases since 2022 there is no prebuilt for Electron 44. Rejected on that alone.

### 3. `@napi-rs/keyring` — maintained successor

Sources: [README](https://github.com/Brooooooklyn/keyring-node/blob/main/README.md), [Cargo.toml](https://github.com/Brooooooklyn/keyring-node/blob/main/Cargo.toml), [index.d.ts](https://github.com/Brooooooklyn/keyring-node/blob/main/index.d.ts), npm registry, [apple-native-keyring-store docs](https://docs.rs/apple-native-keyring-store/latest/apple_native_keyring_store/keychain/index.html).

- npm `2.1.0`, modified 2026-09-13; MIT; `engines.node >= 10`. Prebuilt binaries ship as per-platform `optionalDependencies` (`@napi-rs/keyring-darwin-arm64`, `-darwin-x64`, …) — pnpm installs only the matching one; no node-gyp, no `@electron/rebuild`, no toolchain on the developer's machine.
- It is a Node-API binding (`napi = "3.0.0"`, feature `napi3`) over `keyring-core` with `apple-native-keyring-store` (feature `keychain`) on macOS, the Rust ecosystem maintained by Dan Brotsky (keyring-rs README § History).
- macOS semantics (apple-native-keyring-store): "by default, the 'User' (aka login) keychain is used"; an entry is "a generic credential … whose _account_ attribute holds the user and whose _service_ attribute holds the service"; items "show up in the _Passwords_ view" of Keychain Access. Neither account nor service may be empty.
- API: `new Entry(service, username)` with `setPassword`, `getPassword() → string | undefined`, `deletePassword`; `AsyncEntry` with the same methods returning Promises, taking an optional `AbortSignal`. The typings say a missing item resolves `undefined`, and "rejects if the credential store cannot be read, for example when it is locked or inaccessible" — absence and fault are distinguishable, which is what the no-silent-failures invariant needs.
- Cost in this repo: one runtime dependency in `packages/core`; nothing in the electron-vite build, because the core is not bundled by electron-vite. When packaging arrives, the `.node` binary has to be kept outside the asar (a standard `asarUnpack` line) — the same constraint any native module carries, noted here so the packaging beat expects it.
- Keychain ACL: when an item is created without an explicit access instance, "keychain services uses a default access" whose restricted entry's "list of trusted apps contains only the calling app" ([SecAccessCreate](https://developer.apple.com/documentation/security/secaccesscreate(_:_:_:))). The calling app is the process binary — in development the Electron helper inside `node_modules/electron`, later the signed Vitrine helper. A change of binary (an Electron upgrade in development; the move to a signed build) makes the next read an "untrusted app" read: macOS shows the Allow / Always Allow dialog once, and *Always Allow* adds the new binary to the ACL. This is the same signing caveat Electron documents for `safeStorage`; it is a property of the Keychain, not of the library.

### 4. Shelling out to `security(1)`

Source: `man security` on macOS 26.6.2, and a local probe.

- `add-generic-password -a account -s service -w password [-U]`; `find-generic-password -s service -a account -w` prints the password only; `delete-generic-password`. A missing item exits 44 (`errSecItemNotFound`) with "The specified item could not be found in the keychain" on stderr — verified locally.
- Writing: `-w password` puts the secret on the command line, where it is visible to `ps` on the machine for the duration; the man page's recommended form ("Put at end of command to be prompted") reads from the terminal, which a child process spawned by the core does not have. `-X` (hex) has the same argv exposure.
- ACL: "By default, the application which creates an item is trusted to access its data without warning." Here the creating application is `/usr/bin/security`, so *any* process on the machine running as the user can read the item back silently with the same command. The Keychain protection collapses to "same login" — weaker than an item created by the app binary, which other apps can read only after a dialog.
- Zero dependencies and trivially testable, but it spawns a process per read, parses text output, and the argv leak on write is disqualifying for a credential the brief says never leaves the device except to the provider.

## Cross-cutting questions from the ticket

**A machine without the key.** All four surface it as absence, not error, if handled: `AsyncEntry.getPassword` resolves `undefined`; `security` exits 44; `safeStorage` has no ciphertext file to decrypt (a ciphertext file copied from another Mac fails to decrypt, since the key lives in that machine's Keychain — the file must never be treated as portable). The design answer is the same as **First run** for a missing vault (`CONTEXT.md`): a provider that has no key is a state the surface shows — "no key for <provider>" with the one action *Add a key* — and a Scout that needs one is *blocked on credentials*, visibly, which the brief's "a broken Scout must never look identical to a quiet field" already demands. A locked Keychain or a denied ACL dialog is a fault (rejected Promise, non-44 exit) and is shown as one; it is never collapsed into "no key".

**The iPad PWA.** It has no Host and no Keychain, and per ADR 0005 it is one more HTTP client of the core on the Mac. The model provider is called by the core (ADR 0005 lists "model calls" in the core), so the iPad never holds the key: it sends the request to the core, the core signs it with the key from the Mac's Keychain. This means the credential belongs to the core's process, not the shell's, which is the decisive point against `safeStorage`: routing every read through the shell would make the Mac window a dependency of a request the iPad made. Entering a key from the iPad, if ever wanted, is an authenticated RPC that the core stores — same path as entering it from the Mac renderer.

**Where the key is read.** In every option the API key is in the core's memory whenever a model call is made; the store only decides where it rests. Rest in the Keychain as the credential itself (options 3, 4) or as a ciphertext file plus a Keychain-held key (option 1). Option 1 spreads the secret across two places to reason about; 3 and 4 keep it in one, visible and deletable in Keychain Access by the user under a `Vitrine` service name.

## Comparison

| | `safeStorage` | `keytar` | `@napi-rs/keyring` | `security` CLI |
|---|---|---|---|---|
| Reachable from the core | No — main only; needs Host round-trip | Yes | Yes | Yes |
| Maintained | Electron itself | Archived Dec 2022 | 2.1.0, Sep 2026 | Apple |
| Native build cost | None | V8-ABI prebuilt per Electron major, none for 44 | Node-API prebuilt via optionalDependencies; no rebuild | None |
| What is in the Keychain | App key; ciphertext is a file the core owns | The credential | The credential | The credential |
| Who may read silently | The app binary | The app binary | The app binary | Anyone who runs `security` as the user |
| Write path exposure | In-process | In-process | In-process | Secret on argv |
| Absent vs. fault | `isEncryptionAvailable` + missing file vs decrypt error | resolves null | `undefined` vs rejection | exit 44 vs other |
| Core testable without Electron | Needs a fake Host encryptor | Yes | Yes (a test service name, or a stub `CredentialStore`) | Yes |

## Recommendation

**`@napi-rs/keyring` in the core**, behind a small `CredentialStore` seam (`get(provider)`, `set(provider, key)`, `delete(provider)`) so tests pass an in-memory one and the real one is constructed once in `start.ts`, next to `appSupportDir`. Service name `Vitrine`, account = provider id. Reasons, in order:

1. It is the only option that keeps the credential with the process that uses it. The core makes the model calls (ADR 0005) and the iPad client depends on that; `safeStorage` would route a secret through the shell to reach a main-process module for no gain in protection, and would widen the Host past "what only a desktop shell can do".
2. It is a maintained Node-API binding with prebuilt binaries: no rebuild per Electron major, nothing for electron-vite to bundle, one line for packaging later.
3. The item is a real Keychain entry the user can see and remove in Keychain Access, protected by the standard per-app ACL — the thing `docs/architecture.md` already promised.

Reversibility: the seam makes the store swappable; `security` is the fallback if the native binary ever fails to load, and a `safeStorage` Host round-trip remains possible if a future Electron drops utility-process native modules (nothing in the docs suggests it). What should be recorded in the ADR when beat 7 is specced: the seam, the service/account naming, the *no key* state as a First-run-shaped state rather than an error, and that the Allow/Always Allow dialog is expected once after the first signed build.

Two things to expect, not to fix now: (a) in development the Electron helper is the "calling app", so an Electron upgrade may prompt once on the next read; (b) the async API (`AsyncEntry`) should be used so a Keychain prompt never blocks the core's event loop mid-request.

## Where this file lives

The repo had no place for research notes: `CONTEXT.md` takes vocabulary, `docs/architecture.md` decisions, `docs/adr/` resolved questions. This is none of those — it is the evidence an ADR will cite — so it starts `docs/research/`, one file per wayfinder research ticket, named for its subject. If that convention is wrong, moving the file is the whole cost.
