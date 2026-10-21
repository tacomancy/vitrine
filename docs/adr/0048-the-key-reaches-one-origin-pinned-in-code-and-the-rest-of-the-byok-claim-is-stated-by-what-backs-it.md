# 0048: The key reaches one origin, pinned in code; the rest of the BYOK claim is stated by what backs it

**Status:** Accepted

Issue #749 audited ADR 0017's invariant — "no credentials leave the device except to the configured model provider" — which until then held by the *shape* of the RPC surface and nothing else. The audit found one real hole and the hardening below closes it.

## Decisions

1. **The Anthropic client's origin is a constant, not configuration.** `new Anthropic({ apiKey })` let the SDK (0.131) read `ANTHROPIC_BASE_URL` from the core's environment, so one variable could send `x-api-key` to any host. The client is now built by `anthropicClient` with `baseURL: PROVIDER_ORIGIN` and `authToken: null` (the SDK also reads `ANTHROPIC_AUTH_TOKEN`). There is no environment or option seam for the origin: a test that needs to see the request passes a `fetch` stand-in, which is not reachable in a packaged build.
2. **Every request that carries the key goes through `pinnedFetch`.** It refuses, before sending, any URL whose origin is not `PROVIDER_ORIGIN` (so `http://`, a lookalike subdomain, or a redirect target all fail), and sets `redirect: "error"`, so a 3xx can never forward the header. A refusal surfaces as the provider's ordinary `model` failure, *the provider could not be reached*, with no key and no host in its words. This is the egress allow-list, scoped to the one call site that holds the key rather than a process-wide wrapper: the key is only ever passed to `ModelProvider`, so a wrapper around all of the core's `fetch` would guard nothing the key does not already pass through.
3. **Not done, and why.** A log/error redactor: there is no logging in the core (no `console` call outside tests) and `CredentialFault` already drops what the platform said; a scrubber would guard a surface that does not exist. A proxy-var policy: the core runs on Node's global `fetch`, which ignores `HTTPS_PROXY`/`HTTP_PROXY` unless `NODE_USE_ENV_PROXY` is set, and a proxy sees only the TLS tunnel to the pinned host, never the header. `ANTHROPIC_CUSTOM_HEADERS` still applies (the SDK offers no way to switch it off) but only ever travels to the pinned host.

## Considered options

- **Pin `baseURL` alone.** Rejected: it leaves redirects and any future second client free to carry the header elsewhere; the check is three lines.
- **A process-wide egress wrapper.** Rejected, decision 2.
- **A `VITRINE_*` override for the origin, as for arXiv.** Rejected, decision 1: those endpoints carry no secret; this one would.
