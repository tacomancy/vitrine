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

/**
 * The card fields an Item page's Extraction may fill (ADR 0055 decision 3).
 * Title and link are already known from the listing. Keywords are not asked
 * for: a Proposal has nowhere to keep them, so they would be paid for and
 * dropped.
 */
export type ItemPageField = "authors" | "date" | "venue" | "abstract";

/** One Item page as the model copied it; a field it was not asked for, or did not find, is `null`. */
export type ItemPageFields = {
  authors: string[] | null;
  date: string | null;
  venue: string | null;
  abstract: string | null;
};

export type ItemPageExtraction = { fields: ItemPageFields; usage: Usage };

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
  /** One Item page's fields still empty after what it declared; never called with none. */
  extractItemPage: (req: {
    key: string;
    model: string;
    page: string;
    needed: readonly ItemPageField[];
  }) => Promise<ItemPageExtraction>;
};

export const EXTRACTION_PROMPT =
  "You copy the list of papers from a web page into the card fields. " +
  "Copy, never compose: every value must appear on the page exactly as written, " +
  "and a value that is not on the page is null. Write no summaries, give no " +
  "confidence, and return an empty list when the page lists no papers.";

// Authors are where a model reading one post goes wrong first: the lab is on
// every page, and naming it would make every card from the lab match every
// other on Rank's first signal (ADR 0055 decision 9).
export const ITEM_PAGE_PROMPT =
  "You copy one paper's or post's card fields from its own web page. " +
  "Copy, never compose: every value must appear on the page exactly as written, " +
  "and a value that is not on the page is null. Fill only the fields you are " +
  "asked for and leave every other null. Authors are the people the page names " +
  "in its byline or citation block, each name as written; an organisation is " +
  "never an author. The date is the one the page gives this item, as written. " +
  "The abstract is the summary the page publishes, copied; write no summaries.";

const ITEM_PAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["authors", "date", "venue", "abstract"],
  properties: {
    authors: { type: ["array", "null"], items: { type: "string" } },
    date: { type: ["string", "null"] },
    venue: { type: ["string", "null"] },
    abstract: { type: ["string", "null"] },
  },
} as const;

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
  const unmatched = (usage: Usage) =>
    new ModelError(
      "model",
      "the answer did not match what was asked for",
      usage
    );
  /** One structured-output call, its answer parsed but not yet checked against what was asked. */
  const structured = async (
    key: string,
    model: string,
    system: string,
    content: string,
    schema: Record<string, unknown>
  ): Promise<{ parsed: unknown; usage: Usage }> => {
    let usage: Usage | undefined;
    try {
      const message = await makeClient(key).messages.create({
        model,
        max_tokens: 16_000,
        system,
        messages: [{ role: "user", content }],
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema },
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
      return {
        parsed: JSON.parse(block?.type === "text" ? block.text : "") as unknown,
        usage,
      };
    } catch (cause) {
      // A schema violation arrives as text that does not parse: `model`,
      // not a crash, and the tokens it cost are still recorded.
      if (cause instanceof SyntaxError && usage !== undefined) {
        throw unmatched(usage);
      }
      throw fault(cause, usage);
    }
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
      const { parsed, usage } = await structured(
        key,
        model,
        EXTRACTION_PROMPT,
        page,
        SCHEMA
      );
      const items = (parsed as { items?: unknown } | null)?.items;
      if (!Array.isArray(items)) throw unmatched(usage);
      return { items: items as ExtractedItem[], usage };
    },
    extractItemPage: async ({ key, model, page, needed }) => {
      // The fields asked for lead the message; the page is what is Verified against.
      const { parsed, usage } = await structured(
        key,
        model,
        ITEM_PAGE_PROMPT,
        `Fields asked for: ${needed.join(", ")}\n\n${page}`,
        ITEM_PAGE_SCHEMA
      );
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw unmatched(usage);
      }
      const answer = parsed as Record<string, unknown>;
      const one = (value: unknown) =>
        typeof value === "string" ? value : null;
      const authors = answer.authors;
      return {
        fields: {
          authors:
            Array.isArray(authors) &&
            authors.every((name) => typeof name === "string")
              ? authors
              : null,
          date: one(answer.date),
          venue: one(answer.venue),
          abstract: one(answer.abstract),
        },
        usage,
      };
    },
  };
}
