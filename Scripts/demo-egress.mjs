// Loaded into the core's process by NODE_OPTIONS=--import, by the demos whose
// stand-in answers for the model's API (item-pages, page-change, watched). The
// key is pinned to https://api.anthropic.com in code with no seam (ADR 0048),
// so ANTHROPIC_BASE_URL, which those demos once used, no longer reaches a
// stand-in. This is not a seam either: it is code put into the process through
// the launching environment, which is outside the BYOK claim (architecture.md
// § BYOK). It wraps the global fetch *under* the core's pinned fetch, which
// reads the global at call time: the pin still checks the origin, and only
// then is the request handed to the stand-in instead of the real provider.
// Anything else bound off this machine is refused and written to
// DEMO_EGRESS_LOG, which the demo fails on; the core's only egress is fetch,
// so that is every request it makes. Only the core's utility process is
// wrapped; the shell and the launcher are left alone.
import { appendFileSync } from "node:fs";

const PROVIDER = "https://api.anthropic.com";
const LOCAL = new Set(["127.0.0.1", "localhost", "[::1]"]);

const { DEMO_ORIGIN, DEMO_EGRESS_LOG } = process.env;
if (process.type === "utility" && DEMO_ORIGIN && DEMO_EGRESS_LOG) {
  const inner = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith(`${PROVIDER}/`)) {
      const to = `${DEMO_ORIGIN}${url.slice(PROVIDER.length)}`;
      return input instanceof Request
        ? inner(new Request(to, input), init)
        : inner(to, init);
    }
    if (!LOCAL.has(new URL(url).hostname)) {
      appendFileSync(DEMO_EGRESS_LOG, `${url}\n`);
      return Promise.reject(new Error(`demo: refusing ${url}`));
    }
    return inner(input, init);
  };
}
