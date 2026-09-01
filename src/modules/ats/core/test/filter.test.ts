import { afterEach, describe, expect, it, vi } from "vitest";

import { CONFIG } from "@/constants";

import {
  isNotifyCandidate,
  isNotifyTarget,
  isTarget,
  isTechEntryLevel,
  isTechIntern,
  isTechMidLevel,
  isTechSeniorLevel,
  isUnspecifiedTechLevel,
  shouldBatchAnalyze,
  withinDays,
} from "../filter";

import { JobCategory } from "@/validation/config";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("isTechIntern", () => {
  it("detects tech interns", () => {
    expect(isTechIntern("Software Engineer Intern")).toBe(true);
    expect(isTechIntern("Backend Engineering Internship")).toBe(true);
  });

  it("retains flexible whitespace and hyphen matching", () => {
    expect(isTechIntern("Machine    Learning Engineer Intern")).toBe(true);
    expect(isTechIntern("Front End Engineer Intern")).toBe(true);
  });

  it("treats punctuation in configured words literally", () => {
    expect(isTechIntern("Software Eng. Intern")).toBe(true);
    expect(isTechIntern("Software EngX Intern")).toBe(false);
  });

  it("rejects non-tech interns", () => {
    expect(isTechIntern("Marketing Intern")).toBe(false);
    expect(isTechIntern("HR Internship")).toBe(false);
  });

  it("rejects full time roles", () => {
    expect(isTechIntern("Software Engineer")).toBe(false);
  });
});

describe("isTechEntryLevel", () => {
  it("accepts explicit entry level roles", () => {
    expect(isTechEntryLevel("Software Engineer I")).toBe(true);
    expect(isTechEntryLevel("Junior Backend Engineer")).toBe(true);
    expect(isTechEntryLevel("Entry Level Software Developer")).toBe(true);
    expect(isTechEntryLevel("New Grad SWE")).toBe(true);
  });

  it("rejects unspecified level titles", () => {
    expect(isTechEntryLevel("Software Engineer")).toBe(false);
    expect(isTechEntryLevel("Frontend Developer")).toBe(false);
    expect(isTechEntryLevel("Platform Engineer")).toBe(false);
  });

  it("rejects mid level roles", () => {
    expect(isTechEntryLevel("Software Engineer II")).toBe(false);
    expect(isTechEntryLevel("Mid Level Backend Engineer")).toBe(false);
  });

  it("rejects senior roles", () => {
    expect(isTechEntryLevel("Software Engineer III")).toBe(false);
    expect(isTechEntryLevel("Senior Software Engineer")).toBe(false);
    expect(isTechEntryLevel("Sr. Spclst , Software Engineering")).toBe(false);
  });

  it("rejects interns", () => {
    expect(isTechEntryLevel("Software Engineer Intern")).toBe(false);
  });

  it("rejects non-tech roles", () => {
    expect(isTechEntryLevel("Sales Associate")).toBe(false);
    expect(isTechEntryLevel("Teammate Endzone & Loyalty (Front End)")).toBe(false);
  });
});

describe("isTechMidLevel", () => {
  it("accepts explicit mid level roles", () => {
    expect(isTechMidLevel("Software Engineer II")).toBe(true);
    expect(isTechMidLevel("Mid Level Backend Engineer")).toBe(true);
  });

  it("rejects unspecified level titles", () => {
    expect(isTechMidLevel("Software Engineer")).toBe(false);
    expect(isTechMidLevel("Frontend Developer")).toBe(false);
  });

  it("rejects entry level roles", () => {
    expect(isTechMidLevel("Software Engineer I")).toBe(false);
    expect(isTechMidLevel("Junior Backend Engineer")).toBe(false);
  });

  it("rejects senior roles", () => {
    expect(isTechMidLevel("Software Engineer III")).toBe(false);
    expect(isTechMidLevel("Senior Software Engineer")).toBe(false);
    expect(isTechMidLevel("Sr. Spclst , Software Engineering")).toBe(false);
  });

  it("rejects interns", () => {
    expect(isTechMidLevel("Software Engineer Intern")).toBe(false);
  });
});

describe("isTechSeniorLevel", () => {
  it("accepts explicit senior roles", () => {
    expect(isTechSeniorLevel("Software Engineer III")).toBe(true);
    expect(isTechSeniorLevel("Senior Software Engineer")).toBe(true);
    expect(isTechSeniorLevel("Senior Platform Engineer")).toBe(true);
    expect(isTechSeniorLevel("Sr. Spclst , Software Engineering")).toBe(true);
  });

  it("rejects unspecified level titles", () => {
    expect(isTechSeniorLevel("Software Engineer")).toBe(false);
    expect(isTechSeniorLevel("Frontend Developer")).toBe(false);
  });

  it("rejects entry level roles", () => {
    expect(isTechSeniorLevel("Software Engineer I")).toBe(false);
    expect(isTechSeniorLevel("Junior Backend Engineer")).toBe(false);
  });

  it("rejects mid level roles", () => {
    expect(isTechSeniorLevel("Software Engineer II")).toBe(false);
    expect(isTechSeniorLevel("Mid Level Backend Engineer")).toBe(false);
  });

  it("rejects interns", () => {
    expect(isTechSeniorLevel("Software Engineer Intern")).toBe(false);
  });
});

describe("isUnspecifiedTechLevel", () => {
  it("accepts tech titles with no level signal", () => {
    expect(isUnspecifiedTechLevel("Software Engineer")).toBe(true);
    expect(isUnspecifiedTechLevel("Frontend Developer")).toBe(true);
    expect(isUnspecifiedTechLevel("Platform Engineer")).toBe(true);
  });

  it("rejects intern and explicit level titles", () => {
    expect(isUnspecifiedTechLevel("Software Engineer Intern")).toBe(false);
    expect(isUnspecifiedTechLevel("Junior Backend Engineer")).toBe(false);
    expect(isUnspecifiedTechLevel("Software Engineer II")).toBe(false);
    expect(isUnspecifiedTechLevel("Senior Software Engineer")).toBe(false);
  });

  it("rejects non-tech roles", () => {
    expect(isUnspecifiedTechLevel("Sales Associate")).toBe(false);
  });
});

describe("isTarget", () => {
  it("keeps intern and unspecified titles when includeAllTechJobs is enabled", () => {
    expect(isTarget("Software Engineer Intern", true)).toBe(true);
    expect(isTarget("Software Engineer", true)).toBe(true);
    expect(isTarget("Junior Backend Engineer", true)).toBe(true);
    expect(isTarget("Software Engineer II", true)).toBe(
      isNotifyTarget("Software Engineer II")
    );
    expect(isTarget("Senior Software Engineer", true)).toBe(
      isNotifyTarget("Senior Software Engineer")
    );
  });

  it("keeps notify matches and unspecified titles when includeAllTechJobs is off", () => {
    expect(isTarget("Software Engineer Intern", false)).toBe(
      isNotifyCandidate("Software Engineer Intern")
    );
    expect(isTarget("Junior Backend Engineer", false)).toBe(true);
    expect(isTarget("Software Engineer", false)).toBe(true);
    expect(isTarget("Software Engineer II", false)).toBe(false);
    expect(isTarget("Senior Software Engineer", false)).toBe(false);
  });

  it("rejects non-tech roles", () => {
    expect(isTarget("Marketing Intern")).toBe(false);
    expect(isTarget("Sales Associate")).toBe(false);
  });
});

describe("shouldBatchAnalyze", () => {
  it("batches intern and unspecified titles when includeAllTechJobs is enabled", () => {
    expect(shouldBatchAnalyze("Software Engineer", true)).toBe(true);
    expect(shouldBatchAnalyze("Software Engineer Intern", true)).toBe(
      !isNotifyTarget("Software Engineer Intern")
    );
    expect(shouldBatchAnalyze("Junior Backend Engineer", true)).toBe(false);
    expect(shouldBatchAnalyze("Software Engineer II", true)).toBe(false);
    expect(shouldBatchAnalyze("Senior Software Engineer", true)).toBe(false);
  });

  it("only batches unspecified titles when includeAllTechJobs is off", () => {
    expect(shouldBatchAnalyze("Software Engineer", false)).toBe(true);
    expect(shouldBatchAnalyze("Frontend Developer", false)).toBe(true);
    expect(shouldBatchAnalyze("Software Engineer II", false)).toBe(false);
    expect(shouldBatchAnalyze("Senior Software Engineer", false)).toBe(false);
    expect(shouldBatchAnalyze("Junior Backend Engineer", false)).toBe(false);
  });
});

describe("isNotifyCandidate", () => {
  it("matches notify titles and unspecified tech titles regardless of dashboard mode", () => {
    expect(isNotifyCandidate("Junior Backend Engineer")).toBe(true);
    expect(isNotifyCandidate("Software Engineer")).toBe(true);
    expect(isNotifyCandidate("Software Engineer Intern")).toBe(
      isNotifyTarget("Software Engineer Intern")
    );
    expect(isNotifyCandidate("Software Engineer II")).toBe(false);
    expect(isNotifyCandidate("Senior Software Engineer")).toBe(false);
  });
});

describe("isNotifyTarget", () => {
  it("keeps intern and explicit entry-level tech titles when those categories are configured", () => {
    expect(isNotifyTarget("Junior Backend Engineer")).toBe(true);
    expect(isNotifyTarget("Software Engineer Intern")).toBe(
      Boolean(
        CONFIG.target.intern?.includes(JobCategory.SUMMER_INTERN) ||
          CONFIG.target.intern?.includes(JobCategory.OFF_SEASON_INTERN)
      )
    );
  });

  it("rejects unspecified and explicit mid/senior titles when those categories are not configured", () => {
    expect(isNotifyTarget("Software Engineer")).toBe(false);
    expect(isNotifyTarget("Software Engineer II")).toBe(false);
    expect(isNotifyTarget("Senior Software Engineer")).toBe(false);
  });
});

describe("withinDays", () => {
  it("expands source lookbacks during a discovery catch-up", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T07:17:00.000Z"));

    const saturdayPosting = "2026-08-15T07:00:00.000Z";

    vi.stubEnv("DISCOVERY_LOOKBACK_DAYS", "1");
    expect(withinDays(saturdayPosting, 2)).toBe(false);

    vi.stubEnv("DISCOVERY_LOOKBACK_DAYS", "3");
    expect(withinDays(saturdayPosting, 2)).toBe(true);
  });
});
