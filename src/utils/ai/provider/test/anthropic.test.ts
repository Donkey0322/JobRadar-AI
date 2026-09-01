import { describe, expect, it } from "vitest";

import { ANTHROPIC_BATCH_DISCOUNT, AnthropicProvider, calculateAnthropicCost } from "../anthropic";

describe("calculateAnthropicCost", () => {
  it("returns 0 when usage is missing", () => {
    expect(calculateAnthropicCost(undefined)).toBe(0);
  });

  it("bills input and output tokens at the placeholder rates", () => {
    const cost = calculateAnthropicCost({ input_tokens: 2000, output_tokens: 400 });

    expect(cost).toBeCloseTo(2000 * (3 / 1_000_000) + 400 * (15 / 1_000_000), 10);
  });

  it("discounts batch analysis at 50% of real-time cost", () => {
    const usage = { input_tokens: 1000, output_tokens: 200 };

    expect(calculateAnthropicCost(usage) * ANTHROPIC_BATCH_DISCOUNT).toBeCloseTo(
      calculateAnthropicCost(usage) / 2,
      10
    );
  });
});

describe("AnthropicProvider.parseBatchItem", () => {
  const provider = new AnthropicProvider("test");

  it("extracts tool_use input and applies the batch discount", () => {
    const parsed = provider.parseBatchItem(
      {
        custom_id: "greenhouse:99",
        result: {
          type: "succeeded",
          message: {
            content: [{ type: "tool_use", input: { country: "USA" } }],
            usage: { input_tokens: 1000, output_tokens: 200 },
          },
        },
      },
      false
    );

    expect(parsed).toEqual({
      key: "greenhouse:99",
      result: JSON.stringify({ country: "USA" }),
      cost:
        calculateAnthropicCost({ input_tokens: 1000, output_tokens: 200 }) *
        ANTHROPIC_BATCH_DISCOUNT,
      error: undefined,
    });
  });

  it("keeps errored requests so they can be retried", () => {
    const parsed = provider.parseBatchItem(
      {
        custom_id: "greenhouse:1",
        result: {
          type: "errored",
          error: {
            error: { message: "overloaded" },
          },
        },
      },
      false
    );

    expect(parsed).toEqual({
      key: "greenhouse:1",
      result: null,
      cost: 0,
      error: "overloaded",
    });
  });
});
