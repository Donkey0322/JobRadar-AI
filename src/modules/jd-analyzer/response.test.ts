import { describe, expect, it } from "vitest";

import { parseAIJDResult } from "./response";

const validResponse = {
  citizenship: false,
  sponsorship: true,
  country: "USA",
  location: "New York",
  qualifications: ["TypeScript"],
  category: "entry level",
  season: "None",
};

describe("parseAIJDResult", () => {
  it("parses and normalizes a valid AI response", () => {
    expect(parseAIJDResult(JSON.stringify(validResponse))).toEqual({
      status: "ok",
      jd: validResponse,
    });
  });

  it("distinguishes schema-invalid JSON from malformed JSON", () => {
    const invalid = parseAIJDResult(JSON.stringify({ ...validResponse, country: "Mars" }));
    const malformed = parseAIJDResult("{not-json");

    expect(invalid.status).toBe("invalid");
    if (invalid.status === "invalid") {
      expect(invalid.parsed).toEqual({ ...validResponse, country: "Mars" });
    }
    expect(malformed.status).toBe("parse-error");
  });
});
