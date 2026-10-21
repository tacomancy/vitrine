import Anthropic from "@anthropic-ai/sdk";
import type { Usage } from "./model-prices.js";

/**
 * The one seam to a model (ADR 0017 decision 1). It takes the key per call,
 * so nothing here holds one between runs, and a test passes a stand-in that
 * answers with canned output. Extraction asks for exactly the card fields,
 * each allowed to be missing, and the system prompt says copy, never compose:
 * what comes back is still checked against the page before it is a Proposal
 * (`watched.ts`), because nothing a model says is trusted for being said.
 */

export const DEFAULT_MODEL = "claude-opus-5";

/** A card as the model copied it. Every scalar may be `null`: a missing venue shows as missing. */
export type ExtractedItem = {
  title: string | null;
  authors: string[] | null;
  date: string | null;
  venue: string | null;
  keywords: string[] | null;
  abstract: string | null;
  url: string | null;
};

export type Extraction = { items: ExtractedItem[]; usage: Usage };

/** `credentials` is a 401; `model` is everything else the provider can do wrong, after its retries. */
export class ModelError extends Error {
  constructor(
    readonly kind: "credentials" | "model",
    message: string,
    /** Tokens already spent when the failure came after the call, so the run still records them. */
    readonly usage?: Usage
  ) {
    super(message);
  }
}

export type ModelProvider = {
  countTokens: (req: {
    key: string;
    model: string;
    text: string;
  }) => Promise<number>;
  extract: (req: {
    key: string;
    model: string;
    page: string;
  }) => Promise<Extraction>;
};

export const EXTRACTION_PROMPT =
  "You copy the list of papers from a web page into the card fields. " +
  "Copy, never compose: every value must appear on the page exactly as written, " +
  "and a value that is not on the page is null. Write no summaries, give no " +
  "confidence, and return an empty list when the page lists no papers.";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "authors",
          "date",
          "venue",
          "keywords",
          "abstract",
          "url",
        ],
        properties: {
          title: { type: ["string", "null"] },
          authors: { type: ["array", "null"], items: { type: "string" } },
          date: { type: ["string", "null"] },
          venue: { type: ["string", "null"] },
          keywords: { type: ["array", "null"], items: { type: "string" } },
          abstract: { type: ["string", "null"] },
          url: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;

class NotItems extends Error {}

/**
 * The one host the key may reach (#749). The SDK would otherwise read
 * `ANTHROPIC_BASE_URL` from the environment, so a variable on the core's
 * process could carry the `x-api-key` header anywhere; there is no test seam
 * for the origin on purpose, so a packaged build has no back door either.
 */
export const PROVIDER_ORIGIN = "https://api.anthropic.com";

/**
 * The only way out for a request that carries the key: refuses any other
 * origin before anything is sent, and never follows a redirect, since a
 * redirect is a way to hand the header to a host nobody pinned.
 */
export function pinnedFetch(inner: typeof fetch = fetch): typeof fetch {
  return (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url).origin !== PROVIDER_ORIGIN) {
      return Promise.reject(new Error("refusing a request off the provider"));
    }
    return inner(input, { ...init, redirect: "error" });
  };
}

/**
 * `baseURL` and `authToken` are set explicitly because the SDK reads both from
 * the environment otherwise. `ANTHROPIC_CUSTOM_HEADERS` still applies and
 * cannot be switched off; it only ever travels to the pinned host.
 */
export function anthropicClient(
  apiKey: string,
  egress: typeof fetch = fetch
): Anthropic {
  return new Anthropic({
    apiKey,
    authToken: null,
    baseURL: PROVIDER_ORIGIN,
    fetch: pinnedFetch(egress),
  });
}

/** Anthropic through its SDK; the client is a parameter so a test hands in one that answers from a fixture. */
export function createAnthropicProvider(
  makeClient: (apiKey: string) => Anthropic = (apiKey) =>
    anthropicClient(apiKey, egress),
  egress: typeof fetch = fetch
): ModelProvider {
  const fault = (cause: unknown, usage?: Usage): ModelError => {
    if (cause instanceof ModelError) return cause;
    if (cause instanceof Anthropic.AuthenticationError) {
      return new ModelError("credentials", "key rejected", usage);
    }
    const reason =
      cause instanceof Anthropic.APIError && cause.status !== undefined
        ? `the provider answered HTTP ${cause.status}`
        : "the provider could not be reached";
    return new ModelError("model", reason, usage);
  };
  return {
    countTokens: async ({ key, model, text }) => {
      try {
        const counted = await makeClient(key).messages.countTokens({
          model,
          messages: [{ role: "user", content: text }],
        });
        return counted.input_tokens;
      } catch (cause) {
        throw fault(cause);
      }
    },
    extract: async ({ key, model, page }) => {
      let usage: Usage | undefined;
      try {
        const message = await makeClient(key).messages.create({
          model,
          max_tokens: 16_000,
          system: EXTRACTION_PROMPT,
          messages: [{ role: "user", content: page }],
          output_config: {
            effort: "low",
            format: { type: "json_schema", schema: SCHEMA },
          },
        });
        usage = {
          input: message.usage.input_tokens,
          output: message.usage.output_tokens,
          cacheRead: message.usage.cache_read_input_tokens ?? 0,
        };
        if (message.stop_reason === "refusal") {
          // The category is the provider's own word for why; null when it
          // names none, and then nothing is added (ADR 0017 decision 6).
          const category = message.stop_details?.category;
          throw new ModelError(
            "model",
            `the model refused to read the page${category ? ` (${category})` : ""}`,
            usage
          );
        }
        const block = message.content.find((b) => b.type === "text");
        const parsed = JSON.parse(block?.type === "text" ? block.text : "") as {
          items?: unknown;
        };
        if (!Array.isArray(parsed.items)) throw new NotItems();
        return { items: parsed.items as ExtractedItem[], usage };
      } catch (cause) {
        // A schema violation arrives as text that does not parse: `model`,
        // not a crash, and the tokens it cost are still recorded.
        if (cause instanceof SyntaxError || cause instanceof NotItems) {
          throw new ModelError(
            "model",
            "the answer did not match what was asked for",
            usage
          );
        }
        throw fault(cause, usage);
      }
    },
  };
}
