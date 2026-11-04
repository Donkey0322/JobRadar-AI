import { describe, expect, it } from "vitest";

import { jdResponseSpilled, parseAIJDResult } from "../response";

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
  it("leaves qualifications empty when the screening response omits them", () => {
    const screen = {
      citizenship: validResponse.citizenship,
      sponsorship: validResponse.sponsorship,
      country: validResponse.country,
      location: validResponse.location,
      category: validResponse.category,
      season: validResponse.season,
    };

    expect(parseAIJDResult(JSON.stringify(screen))).toEqual({
      status: "ok",
      jd: {
        ...screen,
        qualifications: null,
      },
    });
  });

  it("parses and normalizes a valid AI response", () => {
    expect(parseAIJDResult(JSON.stringify(validResponse))).toEqual({
      status: "ok",
      jd: validResponse,
    });
  });

  it("drops newline runs and leaked model text from string fields", () => {
    const spilled = `Currently has, or is in the process of obtaining a bachelor${"\n".repeat(40)}---END JD TEXT---JSON parse error: Expected a colon`;

    const parsed = parseAIJDResult(
      JSON.stringify({
        ...validResponse,
        location: `Seattle${"\n".repeat(8)}`,
        qualifications: ["TypeScript", spilled, "\n\n\n"],
      })
    );

    expect(parsed).toEqual({
      status: "ok",
      jd: {
        ...validResponse,
        location: "Seattle",
        qualifications: [
          "TypeScript",
          "Currently has, or is in the process of obtaining a bachelor",
        ],
      },
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

  it("keeps the rest of a qualification split by a short newline run", () => {
    const parsed = parseAIJDResult(
      JSON.stringify({
        ...validResponse,
        qualifications: [
          "Master\n\n\n\n's Degree in Computer Science or a related field",
          'Must be a "U.S. person" as defined by 22 C.F.R. \n\n\n120.62 or otherwise eligible',
          "A Bachelor\nR\n\n\n\nR's degree or equivalent experience",
          "0\n\n\n2 years of professional experience",
          "degree conferral date between October 2027 \n\n\n\nSeptember 2029",
          "Strong organizational and time\n\n\n‑management skills",
        ],
      })
    );

    expect(parsed).toEqual({
      status: "ok",
      jd: {
        ...validResponse,
        qualifications: [
          "Master's Degree in Computer Science or a related field",
          'Must be a "U.S. person" as defined by 22 C.F.R. 120.62 or otherwise eligible',
          "A Bachelor's degree or equivalent experience",
          "0-2 years of professional experience",
          "degree conferral date between October 2027 - September 2029",
          "Strong organizational and time‑management skills",
        ],
      },
    });
  });

  it("flags a dropped spill and ignores a joined continuation", () => {
    const spilled = `Currently has, or is in the process of obtaining a bachelor${"\n".repeat(40)}---END JD TEXT---JSON parse error`;
    const continued = "Master\n\n\n\n's Degree in Computer Science";

    expect(
      jdResponseSpilled(
        JSON.stringify({
          ...validResponse,
          qualifications: [spilled],
        })
      )
    ).toBe(true);
    expect(
      jdResponseSpilled(
        JSON.stringify({
          ...validResponse,
          location: `Seattle${"\n".repeat(8)}`,
          qualifications: [continued],
        })
      )
    ).toBe(false);
  });
});
