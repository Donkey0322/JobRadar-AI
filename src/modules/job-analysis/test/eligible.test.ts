import { describe, expect, it } from "vitest";

import { isEligibleJD } from "../index";

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
