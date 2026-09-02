import { describe, expect, it } from "vitest";

import {
  calculateGoogleCost,
  GOOGLE_BATCH_DISCOUNT,
  googleBatchDurationMs,
  googleResponseText,
} from "../google";

describe("calculateGoogleCost", () => {
  it("returns 0 when usage metadata is missing", () => {
    expect(calculateGoogleCost(undefined)).toBe(0);
  });

  it("bills thinking tokens as output and cached tokens at the discounted rate", () => {
    const cost = calculateGoogleCost({
      promptTokenCount: 2486,
      candidatesTokenCount: 262,
      cachedContentTokenCount: 1537,
      thoughtsTokenCount: 1644,
    });

    const expected =
      (2486 - 1537) * (0.3 / 1_000_000) +
      1537 * (0.03 / 1_000_000) +
      (262 + 1644) * (2.5 / 1_000_000);

    expect(cost).toBeCloseTo(expected, 10);
  });

  it("discounts batch analysis at 50% of real-time cost", () => {
    const usage = {
      promptTokenCount: 1000,
      candidatesTokenCount: 200,
    };

    expect(calculateGoogleCost(usage) * GOOGLE_BATCH_DISCOUNT).toBeCloseTo(
      calculateGoogleCost(usage) / 2,
      10
    );
  });
});

describe("googleBatchDurationMs", () => {
  it("uses createTime and endTime from the Google batch job", () => {
    expect(
      googleBatchDurationMs("2026-09-01T22:59:52.756Z", "2026-09-01T23:03:33.624Z")
    ).toBe(220868);
  });
});

describe("googleResponseText", () => {
  it("reads JSON from candidate parts when the SDK text getter is empty", () => {
    expect(
      googleResponseText({
        text: undefined,
        candidates: [
          {
            content: {
              parts: [{ text: '{"category":"entry level"}' }],
            },
          },
        ],
      } as never)
    ).toBe('{"category":"entry level"}');
  });

  it("prefers the SDK text getter when it is populated", () => {
    expect(
      googleResponseText({
        text: '{"ok":true}',
        candidates: [{ content: { parts: [{ text: "ignored" }] } }],
      } as never)
    ).toBe('{"ok":true}');
  });
});
