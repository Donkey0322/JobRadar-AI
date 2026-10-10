import { describe, expect, it } from "vitest";

import { isEligibleJD, needsQualificationExtraction } from "../index";

import { JobCategory } from "@/validation/config";

const baseJd = {
  sponsorship: null,
  qualifications: ["Bachelor's degree"],
  location: null,
  category: JobCategory.ENTRY_LEVEL,
  season: "None" as const,
};

describe("isEligibleJD", () => {
  it("rejects USA jobs that require citizenship", () => {
    expect(
      isEligibleJD({
        ...baseJd,
        citizenship: true,
        country: "USA",
        location: "Huntsville, AL",
      })
    ).toEqual([false, "citizenship is required"]);
  });

  it("applies the same citizenship filter when the country is Unsure", () => {
    expect(
      isEligibleJD({
        ...baseJd,
        citizenship: true,
        country: "Unsure",
      })
    ).toEqual([false, "citizenship is required"]);
  });

  it("still allows Unsure jobs that do not require citizenship", () => {
    expect(
      isEligibleJD({
        ...baseJd,
        citizenship: null,
        country: "Unsure",
      })
    ).toEqual([true, null]);
  });
});

describe("needsQualificationExtraction", () => {
  const eligible = {
    ...baseJd,
    qualifications: null,
    citizenship: null,
    country: "USA" as const,
    sponsorship: null,
  };

  it("asks for qualifications only when the screened job would be notified", () => {
    expect(needsQualificationExtraction(eligible, "Junior Software Engineer")).toBe(true);
  });

  it("skips qualifications that were already extracted", () => {
    expect(
      needsQualificationExtraction(
        { ...eligible, qualifications: ["TypeScript"] },
        "Junior Software Engineer"
      )
    ).toBe(false);
  });

  it("skips jobs the title filter will not notify", () => {
    expect(needsQualificationExtraction(eligible, "Senior Software Engineer")).toBe(false);
  });

  it("skips jobs that fail the JD filter", () => {
    expect(
      needsQualificationExtraction(
        { ...eligible, category: JobCategory.SENIOR_LEVEL },
        "Junior Software Engineer"
      )
    ).toBe(false);
  });
});
