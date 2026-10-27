// Loaded into the core's process by NODE_OPTIONS=--import, for this demo
// only. The key is pinned to https://api.anthropic.com in code with no seam
// (ADR 0048), so the earlier demos' ANTHROPIC_BASE_URL no longer reaches a
// stand-in. This wraps the global fetch *under* the core's pinned fetch: the
// pin still checks the origin, and only then is the request handed to the
// stand-in instead of the real provider. Anything else bound off this machine
// is refused and written to DEMO_EGRESS_LOG, which the demo fails on. Only the
// core's utility process is wrapped; the shell and the launcher are left alone.
import { appendFileSync } from "node:fs";

const PROVIDER = "https://api.anthropic.com";
const LOCAL = new Set(["127.0.0.1", "localhost", "[::1]"]);

if (process.type === "utility" && process.env.DEMO_PROVIDER) {
  const inner = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith(`${PROVIDER}/`)) {
      const to = `${process.env.DEMO_PROVIDER}${url.slice(PROVIDER.length)}`;
      return input instanceof Request
        ? inner(new Request(to, input), init)
        : inner(to, init);
    }
    if (!LOCAL.has(new URL(url).hostname)) {
      appendFileSync(process.env.DEMO_EGRESS_LOG, `${url}\n`);
      return Promise.reject(new Error(`demo: refusing ${url}`));
    }
    return inner(input, init);
  };
}
