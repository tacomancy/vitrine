// What the shell's preload exposes: exactly the core's port and session token.
interface Window {
  vitrine: { port: number; token: string };
}
