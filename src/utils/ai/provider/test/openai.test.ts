import { describe, expect, it } from "vitest";

import { calculateOpenAICost, OPENAI_BATCH_DISCOUNT, parseOpenAIBatchOutput } from "../openai";

describe("calculateOpenAICost", () => {
  it("returns 0 when usage is missing", () => {
    expect(calculateOpenAICost(undefined)).toBe(0);
  });

  it("bills input and output tokens at the placeholder rates", () => {
    const cost = calculateOpenAICost({ input_tokens: 2000, output_tokens: 400 });

    expect(cost).toBeCloseTo(2000 * (1.25 / 1_000_000) + 400 * (10 / 1_000_000), 10);
  });

  it("discounts batch analysis at 50% of real-time cost", () => {
    const usage = { input_tokens: 1000, output_tokens: 200 };

    expect(calculateOpenAICost(usage) * OPENAI_BATCH_DISCOUNT).toBeCloseTo(
      calculateOpenAICost(usage) / 2,
      10
    );
  });
});

describe("parseOpenAIBatchOutput", () => {
  it("maps custom_id, function_call arguments, and discounted cost", () => {
    const line = JSON.stringify({
      custom_id: "greenhouse:99",
      response: {
        status_code: 200,
        body: {
          output: [{ type: "function_call", arguments: '{"country":"USA"}' }],
          usage: { input_tokens: 1000, output_tokens: 200 },
        },
      },
    });

    expect(parseOpenAIBatchOutput(line)).toEqual([
      {
        key: "greenhouse:99",
        result: '{"country":"USA"}',
        cost:
          calculateOpenAICost({ input_tokens: 1000, output_tokens: 200 }) * OPENAI_BATCH_DISCOUNT,
        error: undefined,
      },
    ]);
  });

  it("keeps request errors so they can be retried", () => {
    const line = JSON.stringify({
      custom_id: "greenhouse:1",
      error: { message: "rate limited" },
    });

    expect(parseOpenAIBatchOutput(line)).toEqual([
      {
        key: "greenhouse:1",
        result: null,
        cost: 0,
        error: "rate limited",
      },
    ]);
  });
});
