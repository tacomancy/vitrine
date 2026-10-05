import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { createAnthropicProvider, ModelError } from "./model-provider.js";

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
