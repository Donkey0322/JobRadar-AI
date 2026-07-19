import { describe, expect, it } from "vitest";

import { isWorkdayLocaleSegment } from "./workday";

describe("isWorkdayLocaleSegment", () => {
  it("accepts any locale letter casing in lenient tracker mode", () => {
    expect(isWorkdayLocaleSegment("en-US", "lenient")).toBe(true);
    expect(isWorkdayLocaleSegment("EN-us", "lenient")).toBe(true);
    expect(isWorkdayLocaleSegment("en-us", "lenient")).toBe(true);
  });

  it("accepts only lower-language upper-country casing in strict JD mode", () => {
    expect(isWorkdayLocaleSegment("en-US", "strict")).toBe(true);
    expect(isWorkdayLocaleSegment("EN-us", "strict")).toBe(false);
    expect(isWorkdayLocaleSegment("en-us", "strict")).toBe(false);
  });

  it("rejects non-locale path segments in both modes", () => {
    expect(isWorkdayLocaleSegment("external", "lenient")).toBe(false);
    expect(isWorkdayLocaleSegment("external", "strict")).toBe(false);
  });
});
