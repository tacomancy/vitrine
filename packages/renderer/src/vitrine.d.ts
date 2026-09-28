// What the shell's preload exposes: the core's port and session token, and
// where on disk a dropped file is (ADR 0035). A browser client — the iPad —
// has no preload, and so no drop onto an Experiment page.
interface Window {
  vitrine: { port: number; token: string; pathOf: (file: File) => string };
}
