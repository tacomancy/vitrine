import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  createAnthropicProvider,
  ITEM_PAGE_PROMPT,
  ModelError,
} from "./model-provider.js";

// The provider's three ways of failing on a read (spec #463; ADR 0017
// decision 7), each against a client that answers from a recorded shape: a
// refusal says its category, a schema violation is a `model` failure and not
// a crash, and either still reports the tokens it cost.

const USAGE = { input_tokens: 900, output_tokens: 40 };

const provider = (reply: unknown) =>
  createAnthropicProvider(
    () =>
      ({
        messages: { create: () => Promise.resolve(reply) },
      }) as unknown as Anthropic
  );

const extract = (reply: unknown) =>
  provider(reply)
    .extract({ key: "sk-test", model: "m", page: "text" })
    .catch((error: unknown) => error as ModelError);

describe("a read the model cannot give", () => {
  it("says a refusal's category, and keeps the tokens it cost", async () => {
    const error = await extract({
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "cyber" },
      content: [],
      usage: USAGE,
    });

    expect(error).toBeInstanceOf(ModelError);
    expect(error).toMatchObject({
      kind: "model",
      message: "the model refused to read the page (cyber)",
      usage: { input: 900, output: 40, cacheRead: 0 },
    });
  });

  it("says a refusal with no named category without inventing one", async () => {
    const error = await extract({
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: null },
      content: [],
      usage: USAGE,
    });

    expect(error).toMatchObject({
      message: "the model refused to read the page",
    });
  });

  it("is a model failure, not a crash, when the answer is not the schema", async () => {
    for (const text of ["not json at all", '{"papers": []}']) {
      const error = await extract({
        stop_reason: "end_turn",
        content: [{ type: "text", text }],
        usage: USAGE,
      });
      expect(error).toMatchObject({
        kind: "model",
        message: "the answer did not match what was asked for",
        usage: { input: 900 },
      });
    }
  });
});

// The Item page's call (#886; ADR 0055 decision 3): the same structured
// output and the same failures, asked for one page's missing fields.

describe("reading one Item page", () => {
  const created: Array<Record<string, unknown>> = [];
  const itemProvider = (reply: unknown) =>
    createAnthropicProvider(
      () =>
        ({
          messages: {
            create: (request: Record<string, unknown>) => {
              created.push(request);
              return Promise.resolve(reply);
            },
          },
        }) as unknown as Anthropic
    );
  const read = (reply: unknown) =>
    itemProvider(reply)
      .extractItemPage({
        key: "sk-test",
        model: "m",
        page: "# A post\nBy Ada Rowe",
        needed: ["authors", "abstract"],
      })
      .catch((error: unknown) => error as ModelError);

  it("asks for the fields still needed under the copy-never-compose prompt, and returns what came back with its usage", async () => {
    created.length = 0;
    const answer = await read({
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: JSON.stringify({
            authors: ["Ada Rowe"],
            date: null,
            venue: null,
            abstract: null,
          }),
        },
      ],
      usage: { ...USAGE, cache_read_input_tokens: 12 },
    });

    expect(answer).toEqual({
      fields: {
        authors: ["Ada Rowe"],
        date: null,
        venue: null,
        abstract: null,
      },
      usage: { input: 900, output: 40, cacheRead: 12 },
    });
    const [request] = created;
    expect(request!.system).toBe(ITEM_PAGE_PROMPT);
    expect(ITEM_PAGE_PROMPT).toMatch(/Copy, never compose/);
    expect(ITEM_PAGE_PROMPT).toMatch(/an organisation is never an author/);
    expect(request!.messages).toEqual([
      {
        role: "user",
        content: "Fields asked for: authors, abstract\n\n# A post\nBy Ada Rowe",
      },
    ]);
    expect(request!.output_config).toMatchObject({
      format: {
        type: "json_schema",
        schema: {
          required: ["authors", "date", "venue", "abstract"],
          additionalProperties: false,
        },
      },
    });
  });

  it("is a model failure when the answer is not the schema, and keeps the tokens it cost", async () => {
    for (const text of ["not json at all", "[]"]) {
      expect(
        await read({
          stop_reason: "end_turn",
          content: [{ type: "text", text }],
          usage: USAGE,
        })
      ).toMatchObject({
        kind: "model",
        message: "the answer did not match what was asked for",
        usage: { input: 900 },
      });
    }
  });

  it("gives null for a field of the wrong shape, which is no value the page gave", async () => {
    expect(
      await read({
        stop_reason: "end_turn",
        content: [
          { type: "text", text: '{"authors": "Ada Rowe", "date": 2025}' },
        ],
        usage: USAGE,
      })
    ).toMatchObject({
      fields: { authors: null, date: null, venue: null, abstract: null },
    });
  });

  it("says a refusal as the listing's call does", async () => {
    const answer = await read({
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: null },
      content: [],
      usage: USAGE,
    });

    expect(answer).toMatchObject({
      kind: "model",
      message: "the model refused to read the page",
      usage: { input: 900 },
    });
  });
});
