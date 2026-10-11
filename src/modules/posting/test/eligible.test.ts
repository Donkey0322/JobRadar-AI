import { describe, expect, it } from "vitest";

import type { JD } from "@/types";

import { Posting } from "../posting";

import { JobCategory } from "@/validation/config";

const baseJd = {
  sponsorship: null,
  qualifications: ["Bachelor's degree"],
  location: null,
  category: JobCategory.ENTRY_LEVEL,
  season: "None" as const,
};

function posting(jd: JD, role = "Junior Software Engineer") {
  return Posting.from({
    company: "Acme",
    role,
    link: "https://example.com/jobs/1",
    location: "Remote",
    jd,
  });
}

describe("Posting.isEligible", () => {
  it("rejects USA jobs that require citizenship", () => {
    const candidate = posting({
      ...baseJd,
      citizenship: true,
      country: "USA",
      location: "Huntsville, AL",
    });

    expect(candidate.isEligible()).toEqual([false, "citizenship is required"]);
    expect(candidate.decideNotification()).toEqual({
      action: "skip",
      kind: "ineligible",
      reason: "citizenship is required",
    });
  });

  it("applies the same citizenship filter when the country is Unsure", () => {
    expect(
      posting({
        ...baseJd,
        citizenship: true,
        country: "Unsure",
      }).isEligible()
    ).toEqual([false, "citizenship is required"]);
  });

  it("still allows Unsure jobs that do not require citizenship", () => {
    expect(
      posting({
        ...baseJd,
        citizenship: null,
        country: "Unsure",
      }).isEligible()
    ).toEqual([true, null]);
  });

  it("requires analysis before checking eligibility", () => {
    expect(() =>
      Posting.from({
        company: "Acme",
        role: "Engineer",
        link: "https://example.com/jobs/2",
        location: "Remote",
      }).isEligible()
    ).toThrow("Posting must be analyzed");
  });
});

describe("Posting.needsQualifications", () => {
  const eligible = {
    ...baseJd,
    qualifications: null,
    citizenship: null,
    country: "USA" as const,
    sponsorship: null,
  };

  it("asks for qualifications only when the screened job would be notified", () => {
    expect(posting(eligible).needsQualifications()).toBe(true);
  });

  it("skips qualifications that were already extracted", () => {
    expect(posting({ ...eligible, qualifications: ["TypeScript"] }).needsQualifications()).toBe(
      false
    );
  });

  it("skips jobs the title filter will not notify", () => {
    expect(posting(eligible, "Senior Software Engineer").needsQualifications()).toBe(false);
  });

  it("skips jobs that fail the JD filter", () => {
    expect(posting({ ...eligible, category: JobCategory.SENIOR_LEVEL }).needsQualifications()).toBe(
      false
    );
  });
});
