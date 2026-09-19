# 0005: TypeScript end to end, Electron, React, with the core as a local HTTP API

**Status:** Accepted

ADR 0001 committed to web technology in a desktop shell and left the shell, UI framework, language, and test runner open (`docs/architecture.md` § Open, item 1). This ADR settles the structural part after a `grill-me` pass: one TypeScript codebase in a pnpm workspace of three packages — `core` (a Node server: vault, file watcher, ingest, Scouts, model calls), `renderer` (React), and `shell` (Electron, which spawns the core and opens the window and does nothing else). The renderer never touches Node or the file system: it is a browser client of the core over a local HTTP API with a typed RPC contract, which is exactly what the phase-2 iPad PWA (ADR 0003) will be. The reversible detail — test runner, RPC and HTTP libraries, lint, compiler flags, fonts — lives in `docs/architecture.md`, not here.

## Considered options

- **Tauri.** Rejected. Its own backend is Rust; with a TypeScript core the backend becomes a Node sidecar beside a system WebView, two runtimes to keep in step, and the vendored skills, the prototypes (React), and the `tdd` loop are all TypeScript-shaped. Electron's cost is bundle size and memory, cheap for a single-user research tool. Because the core is a standalone server, moving to Tauri later is a shell swap, not a rewrite.
- **A Rust core with a TypeScript renderer.** Rejected. The load-bearing logic — annotation re-matching, derived Hypothesis state, Scout source health — would live in a language none of the project's tooling covers, and the iPad client would need the same rules re-expressed in TypeScript anyway.
- **Renderer talks to the core over Electron IPC.** Rejected. The iPad PWA needs the same operations over HTTP, so IPC means two transports for one API, and a core that cannot be exercised without Electron in the loop. With the HTTP API, the test suite drives the core with plain requests and no Electron harness.
- **Svelte or Solid instead of React.** Rejected. The prototypes are React and port as they are; the Reader (PDF.js), the Vault editor, and the charts all have React bindings first. Runtime savings do not outweigh that.
- **One package with folders, converting to a workspace later.** Rejected. The renderer/core boundary is the point of the topology decision, and a folder line does not stop an import; a workspace does, and `setup-ts-deep-modules` enforces it.

## Consequences

- **+** One language, one test suite, one contract type shared by the renderer and the core. The iPad client falls out of the topology instead of being a second transport.
- **+** The renderer runs with `sandbox: true` and no preload beyond the core's port and a session token. The core runs in an Electron `utilityProcess`, so a crash there does not take the window down.
- **+** The core is testable without a window, which is what the `tdd` loop and the CI required check need.
- **−** PDF bytes and vault files cross a localhost socket instead of a function call. Fine on one machine; it means the core, not the renderer, owns file access, including for the Vault editor.
- **−** The core's lifetime is the app's. On macOS closing the window does not quit the app, so Scouts keep running while the dock icon is there; a cadence missed while quit is caught up on next launch, visibly in Scout Activity's "last run". A `launchd` agent is a later, reversible upgrade if daily Scouts prove they want it.
- **−** Binding the core to the LAN for phase 2 needs pairing and auth; the session token exists from day one so that is an extension, not a redesign.
- Derived state is computed in the core and displayed by the renderer, never derived client-side. The renderer keeps no global store until a second surface needs one; server state goes through the RPC client's query cache.
- Deferred, deliberately: the end-to-end runner (chosen by the first slice that has a window to drive), packaging, signing and updates, LAN pairing.
