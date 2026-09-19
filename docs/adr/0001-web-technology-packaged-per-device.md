# 0001: Web technology, one codebase, packaged per device

**Status:** Accepted

The brief (`design-brief.md` § Platforms and constraints) commits to one web-technology codebase: a desktop shell on the Mac with real file-system access, and the same app opened on the iPad as a full-screen PWA over the local network. The dashboards are chart- and table-heavy, which is far cheaper in web tooling than in native UI, and the PWA removes iPad provisioning entirely. This replaces v1's native SwiftUI app (`main` history, ADR 0001 there); nothing from v1 carries over except `docs/reference/branding/`.

## Considered options

- **Native SwiftUI, as v1.** Rejected: charts and tables cost more, and the iPad needs a developer account and a second build.
- **Web app served from a local process with no shell.** Rejected for the Mac: no dock presence, no window, and file-system access would go through a browser.

## Consequences

- **+** One codebase; the iPad Reader (brief phase 2) is the same app at another size.
- **−** Pencil fidelity on the iPad is capped at browser pointer events until a native Reader (phase 3) is justified.
- The shell (Electron or Tauri), UI framework, PDF renderer, and Markdown parser are still open. They are decided by their own ADRs after a `grill-me` pass and recorded in `docs/architecture.md`.
