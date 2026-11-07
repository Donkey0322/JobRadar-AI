import { describe, expect, it } from "vitest";

import { SEASONS } from "@/constants/season";

import type { ZodError } from "zod";

import { jdResponseSpilled, parseAIJDResult } from "../response";
import { parseStoredJD } from "../validation/ai";

const validResponse = {
  citizenship: false,
  sponsorship: true,
  country: "USA",
  location: "New York",
  qualifications: ["TypeScript"],
  category: "entry level",
  season: "None",
};

describe("parseStoredJD", () => {
  it("keeps stored JDs from past seasons and screening JDs without qualifications", () => {
    const pastSummer = { ...validResponse, category: "summer intern", season: "2025 Summer" };
    const pastFall = { ...validResponse, category: "off-season intern", season: "2024 Fall" };
    const screening = { ...validResponse, qualifications: null };

    expect(parseStoredJD(pastSummer)).toEqual(pastSummer);
    expect(parseStoredJD(pastFall)).toEqual(pastFall);
    expect(parseStoredJD(screening)).toEqual(screening);
  });

  it.each(["entry level", "mid level", "senior level"])(
    "normalizes the stored season of %s to None",
    (category) => {
      const stored = { ...validResponse, category, season: "2025 Summer" };

      expect(parseStoredJD(stored)).toEqual({ ...stored, season: "None" });
      expect(stored.season).toBe("2025 Summer");
    }
  );

  it.each([
    ["summer intern", "2025 Fall"],
    ["summer intern", "2026 Winter"],
    ["off-season intern", "2025 Summer"],
  ])("rejects a stored %s with season %s", (category, season) => {
    expect(parseStoredJD({ ...validResponse, category, season })).toBeNull();
  });

  it("rejects the legacy Thomson Reuters JREQ199695 JD and other missing fields", () => {
    expect(
      parseStoredJD({
        citizenship: false,
        sponsorship: null,
        location: "Other",
        qualifications: [],
        season: "Senior Level",
      })
    ).toBeNull();
    const { category: _category, ...noCategory } = validResponse;
    expect(parseStoredJD(noCategory)).toBeNull();
    expect(parseStoredJD(undefined)).toBeNull();
  });
});

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

  it("rejects the legacy Thomson Reuters JREQ199695 JD that has no country or category", () => {
    // Written to opportunities by batch collect 6d4e383d; qualifications shortened.
    const legacy = {
      citizenship: false,
      sponsorship: null,
      location: "Other",
      qualifications: [
        "Have 5-8 years total experience.",
        "Possess 2-4 years production GenAI/LLM experience.",
      ],
      season: "Senior Level",
    };

    const parsed = parseAIJDResult(JSON.stringify(legacy));

    expect(parsed.status).toBe("invalid");
    if (parsed.status === "invalid") {
      expect((parsed.error as ZodError).issues.map((issue) => issue.path.join("."))).toEqual(
        expect.arrayContaining(["country", "category", "season"])
      );
    }
  });

  it.each([
    ["summer intern", SEASONS.summer],
    ["summer intern", "None"],
    ["off-season intern", SEASONS.fall],
    ["off-season intern", SEASONS.spring],
    ["off-season intern", SEASONS.winter],
    ["off-season intern", "None"],
  ])("keeps %s with season %s", (category, season) => {
    expect(parseAIJDResult(JSON.stringify({ ...validResponse, category, season }))).toEqual({
      status: "ok",
      jd: { ...validResponse, category, season },
    });
  });

  it.each([
    ["summer intern", SEASONS.fall],
    ["summer intern", SEASONS.spring],
    ["summer intern", SEASONS.winter],
    ["off-season intern", SEASONS.summer],
  ])("rejects %s with season %s", (category, season) => {
    const parsed = parseAIJDResult(JSON.stringify({ ...validResponse, category, season }));

    expect(parsed.status).toBe("invalid");
    if (parsed.status === "invalid") {
      expect((parsed.error as ZodError).issues).toEqual([
        expect.objectContaining({ path: ["season"], code: "custom" }),
      ]);
    }
  });

  it.each(["entry level", "mid level", "senior level"])(
    "normalizes the season of %s to None",
    (category) => {
      expect(
        parseAIJDResult(JSON.stringify({ ...validResponse, category, season: SEASONS.summer }))
      ).toEqual({
        status: "ok",
        jd: { ...validResponse, category, season: "None" },
      });
    }
  );

  it("does not fill in a year the model left out", () => {
    for (const season of ["Summer", `${Number.parseInt(SEASONS.summer) + 1} Summer`]) {
      const parsed = parseAIJDResult(
        JSON.stringify({ ...validResponse, category: "summer intern", season })
      );

      expect(parsed.status).toBe("invalid");
    }
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
