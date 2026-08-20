import { describe, expect, it } from "vitest";

import { calculateGoogleCost } from "../google";

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
});
