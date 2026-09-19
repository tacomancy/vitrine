# Architecture

Technical decisions the brief structurally couldn't hold: library choices, file formats, how ingestion triggers. Living; edited as work proceeds. A decision that is hard to reverse also gets an ADR in `docs/adr/`, and this file points at it.

## Decided

- Web technology, one codebase, packaged per device — ADR 0001.
- Annotations in the PDF; sidecar index for identity — ADR 0002.
- Phase 1 reading is Preview plus ingest; sync scope is the PDF folder only — ADR 0003.
- The public site at tacomancy.com is static files in `website/`, assembled by `Scripts/build-site.sh` and deployed by `.github/workflows/pages.yml` on push to `main` — ADR 0004.
- TypeScript end to end; Electron; React; the core is a local HTTP API the renderer and the iPad PWA are both clients of; a pnpm workspace of `packages/core`, `packages/renderer`, `packages/shell` — ADR 0005. The detail that ADR leaves to this file:
  - **Build and dev:** Vite for the renderer, `electron-vite` driving main, preload, and renderer from one config. Packaging, signing, and updates are chosen when there is something worth installing.
  - **Tests:** Vitest, for `core` and `renderer` alike; it is the CI required check (`.github/workflows/ci.yml`). The end-to-end runner is chosen by the first slice that has a window to drive.
  - **RPC:** tRPC; the router type in `core` is the contract, imported type-only by `renderer`. Pushes the brief needs (ingest landed, Scout finished, Unmatched annotation surfaced) are tRPC subscriptions over SSE, so no WebSocket server. Server state in the renderer goes through tRPC's TanStack Query integration; UI state is React local state; no global store until a second surface needs one.
  - **HTTP server:** Hono, hosting the tRPC adapter, the renderer bundle for the iPad, and PDF bytes for the Reader. Handlers are testable with a `Request` and no socket.
  - **Styling:** plain CSS with CSS Modules per component, importing `docs/reference/branding/tokens.css` unchanged. Not Tailwind: BRAND.md law 1 (semantic tokens, never ramp steps) is a lint rule on `--color-<ramp>-*` outside `tokens.css`.
  - **Fonts:** bundled via `@fontsource` — Inter, IBM Plex Mono, Josefin Sans for the wordmark, and Source Serif 4 for questions and quotations, the role the prototypes drew and ADR 0004 asked this decision to settle. Nothing loads from Google Fonts in the app.
  - **Lint and format:** ESLint (typescript-eslint) and Prettier, as the vendored `setup-pre-commit` expects; dependency-cruiser via `setup-ts-deep-modules` once the packages exist.
  - **Compiler:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`. Node is whatever the current Electron ships.
  - **Core lifetime:** the app's. No `launchd` agent unless daily Scouts prove they want one.

## Open, in the order they block work

1. Vault file layout: how a Question, Research Question, Hypothesis, Experiment, and Source stub are written as Markdown, and where the sidecar index lives.
2. PDF renderer and annotation library for the Reader.
3. Markdown parser, and the tag grammar it shares with the tag tree.
4. How ingest is triggered (file watcher) and coalesced.

Each goes through `grill-me` before its ADR is written.
