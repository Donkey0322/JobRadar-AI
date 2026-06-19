import { describe, expect, it, vi } from "vitest";

vi.mock("../company-tacker/ats", () => ({
  parseCustomCompanyIdentifier: vi.fn((url: URL) => {
    const host = url.hostname;

    if (host.endsWith("amazon.jobs")) return "amazon";
    if (host.endsWith("microsoft.com")) return "microsoft";
    if (host.endsWith("google.com")) return "google";
    if (host.endsWith("metacareers.com")) return "meta";
    if (host.endsWith("jobs.apple.com")) return "apple";
    if (host.endsWith("netflix.net")) return "netflix";

    return null;
  }),
}));

import {
  getAshbyKey,
  getCustomKey,
  getGreenhouseKey,
  getIcimsKey,
  getLeverKey,
  getOracleKey,
  getSmartRecruitersKey,
  getWorkdayKey,
} from "./ats";

describe("getGreenhouseKey", () => {
  it("uses gh_jid from query params first", () => {
    // Arrange
    const url = new URL("https://job-boards.greenhouse.io/acme/jobs/123456?gh_jid=999999");
    const expected = "greenhouse:999999";

    // Act
    const result = getGreenhouseKey(url);

    // Assert
    expect(result).toBe(expected);
  });

  it("uses numeric id from pathname when gh_jid does not exist", () => {
    // Arrange
    const url = new URL("https://job-boards.greenhouse.io/acme/jobs/123456");
    const expected = "greenhouse:123456";

    // Act
    const result = getGreenhouseKey(url);

    // Assert
    expect(result).toBe(expected);
  });

  it("uses token when there is no numeric id in pathname", () => {
    // Arrange
    const url = new URL("https://boards.greenhouse.io/embed/job_app?token=8577877002");
    const expected = "greenhouse:8577877002";

    // Act
    const result = getGreenhouseKey(url);

    // Assert
    expect(result).toBe(expected);
  });

  it("returns null when no greenhouse id can be found", () => {
    // Arrange
    const url = new URL("https://job-boards.greenhouse.io/acme/jobs/software-engineer");
    const expected = null;

    // Act
    const result = getGreenhouseKey(url);

    // Assert
    expect(result).toBe(expected);
  });
});

describe("getWorkdayKey", () => {
  it("extracts workday id after the last underscore", () => {
    // Arrange
    const url =
      "https://intel.wd1.myworkdayjobs.com/en-us/external/job/US-Arizona-Phoenix/AI-Software-Engineering-Intern_JR0282641";
    const expected = "workday:JR0282641";

    // Act
    const result = getWorkdayKey(url);

    // Assert
    expect(result).toBe(expected);
  });

  it("extracts workday id before query string", () => {
    // Arrange
    const url =
      "https://company.wd1.myworkdayjobs.com/external/job/New-York/Software-Engineer_R-12345?source=LinkedIn";
    const expected = "workday:R-12345";

    // Act
    const result = getWorkdayKey(url);

    // Assert
    expect(result).toBe(expected);
  });

  it("removes trailing workday duplicate suffix like -1", () => {
    // Arrange
    const url =
      "https://company.wd1.myworkdayjobs.com/external/job/New-York/Software-Engineer_R-12345-1";
    const expected = "workday:R-12345";

    // Act
    const result = getWorkdayKey(url);

    // Assert
    expect(result).toBe(expected);
  });

  it("returns null when there is no underscore id", () => {
    // Arrange
    const url = "https://company.wd1.myworkdayjobs.com/external/job/New-York/software-engineer";
    const expected = null;

    // Act
    const result = getWorkdayKey(url);

    // Assert
    expect(result).toBe(expected);
  });
});

describe("getAshbyKey", () => {
  it("extracts ashby job id from pathname segment 2", () => {
    // Arrange
    const url = new URL("https://jobs.ashbyhq.com/acme/abc-def-123");
    const expected = "ashby:abc-def-123";

    // Act
    const result = getAshbyKey(url);

    // Assert
    expect(result).toBe(expected);
  });

  it("normalizes ashby id to lowercase", () => {
    // Arrange
    const url = new URL("https://jobs.ashbyhq.com/acme/ABC-DEF-123");
    const expected = "ashby:abc-def-123";

    // Act
    const result = getAshbyKey(url);

    // Assert
    expect(result).toBe(expected);
  });

  it("returns null when id segment does not exist", () => {
    // Arrange
    const url = new URL("https://jobs.ashbyhq.com/acme");
    const expected = null;

    // Act
    const result = getAshbyKey(url);

    // Assert
    expect(result).toBe(expected);
  });
});

describe("getLeverKey", () => {
  it("extracts lever job id from pathname segment 2", () => {
    // Arrange
    const url = new URL("https://jobs.lever.co/acme/abc-def-123");
    const expected = "lever:abc-def-123";

    // Act
    const result = getLeverKey(url);

    // Assert
    expect(result).toBe(expected);
  });

  it("normalizes lever id to lowercase", () => {
    // Arrange
    const url = new URL("https://jobs.lever.co/acme/ABC-DEF-123");
    const expected = "lever:abc-def-123";

    // Act
    const result = getLeverKey(url);

    // Assert
    expect(result).toBe(expected);
  });

  it("returns null when id segment does not exist", () => {
    // Arrange
    const url = new URL("https://jobs.lever.co/acme");
    const expected = null;

    // Act
    const result = getLeverKey(url);

    // Assert
    expect(result).toBe(expected);
  });
});

describe("getSmartRecruitersKey", () => {
  it("extracts numeric id from pathname", () => {
    // Arrange
    const pathname = "/SmartRecruiters-Inc/743999999999999-software-engineer-intern";
    const expected = "smartrecruiters:743999999999999";

    // Act
    const result = getSmartRecruitersKey(pathname);

    // Assert
    expect(result).toBe(expected);
  });

  it("returns null when pathname has no numeric id", () => {
    // Arrange
    const pathname = "/SmartRecruiters-Inc/software-engineer-intern";
    const expected = null;

    // Act
    const result = getSmartRecruitersKey(pathname);

    // Assert
    expect(result).toBe(expected);
  });
});

describe("getOracleKey", () => {
  it("extracts oracle job id from /job/:id", () => {
    // Arrange
    const pathname = "/careers/job/123456789/software-engineer";
    const expected = "oraclecloud:123456789";

    // Act
    const result = getOracleKey(pathname);

    // Assert
    expect(result).toBe(expected);
  });

  it("is case insensitive for /job", () => {
    // Arrange
    const pathname = "/careers/JOB/123456789/software-engineer";
    const expected = "oraclecloud:123456789";

    // Act
    const result = getOracleKey(pathname);

    // Assert
    expect(result).toBe(expected);
  });

  it("returns null when /job/:id does not exist", () => {
    // Arrange
    const pathname = "/careers/software-engineer/123456789";
    const expected = null;

    // Act
    const result = getOracleKey(pathname);

    // Assert
    expect(result).toBe(expected);
  });
});

describe("getIcimsKey", () => {
  it("extracts icims job id from /jobs/:id", () => {
    // Arrange
    const pathname = "/jobs/123456/software-engineer-intern/job";
    const expected = "icims:123456";

    // Act
    const result = getIcimsKey(pathname);

    // Assert
    expect(result).toBe(expected);
  });

  it("is case insensitive for /jobs", () => {
    // Arrange
    const pathname = "/JOBS/123456/software-engineer-intern/job";
    const expected = "icims:123456";

    // Act
    const result = getIcimsKey(pathname);

    // Assert
    expect(result).toBe(expected);
  });

  it("returns null when /jobs/:id does not exist", () => {
    // Arrange
    const pathname = "/job/123456/software-engineer-intern";
    const expected = null;

    // Act
    const result = getIcimsKey(pathname);

    // Assert
    expect(result).toBe(expected);
  });
});

describe("getCustomKey", () => {
  it("uses custom company identifier with numeric pathname id", () => {
    // Arrange
    const url =
      "https://www.google.com/about/careers/applications/jobs/results/101633639661347526-data-center-facilities-technician";
    const expected = "google:101633639661347526";

    // Act
    const result = getCustomKey(url);

    // Assert
    expect(result).toBe(expected);
  });

  it("uses custom company identifier with origin + pathname when no numeric pathname id exists", () => {
    // Arrange
    const url = "https://www.microsoft.com/en-us/careers/job/software-engineer";
    const expected = "microsoft:https://www.microsoft.com/en-us/careers/job/software-engineer";

    // Act
    const result = getCustomKey(url);

    // Assert
    expect(result).toBe(expected);
  });

  it("extracts REQ id from jobReq query param", () => {
    // Arrange
    const url = "https://careers.salesforce.com/en/jobs?jobReq=REQ-123456&source=LinkedIn";
    const expected = "custom:REQ-123456";

    // Act
    const result = getCustomKey(url);

    // Assert
    expect(result).toBe(expected);
  });

  it("extracts REQ id from jobReq query param with underscore", () => {
    // Arrange
    const url = "https://example.com/jobs?jobReq=REQ_123456";
    const expected = "custom:REQ_123456";

    // Act
    const result = getCustomKey(url);

    // Assert
    expect(result).toBe(expected);
  });

  it("extracts REQ id from jobReq query param without separator", () => {
    // Arrange
    const url = "https://example.com/jobs?jobReq=REQ123456";
    const expected = "custom:REQ123456";

    // Act
    const result = getCustomKey(url);

    // Assert
    expect(result).toBe(expected);
  });

  it("extracts generic numeric id from query params", () => {
    // Arrange
    const url = "https://example.com/jobs/software-engineer?id=987654";
    const expected = "custom:987654";

    // Act
    const result = getCustomKey(url);

    // Assert
    expect(result).toBe(expected);
  });

  it("uses the first generic numeric query value with at least 4 digits", () => {
    // Arrange
    const url = "https://example.com/jobs/software-engineer?foo=abc&bar=job-123456&baz=999999";
    const expected = "custom:123456";

    // Act
    const result = getCustomKey(url);

    // Assert
    expect(result).toBe(expected);
  });

  it("ignores generic numeric query values shorter than 4 digits", () => {
    // Arrange
    const url = "https://example.com/jobs/software-engineer?id=123";
    const expected = "custom:https://example.com/jobs/software-engineer?id=123";

    // Act
    const result = getCustomKey(url);

    // Assert
    expect(result).toBe(expected);
  });

  it("falls back to origin + pathname + query to avoid merging different custom URLs", () => {
    // Arrange
    const urlA = "https://example.com/jobs/software-engineer?location=us";
    const urlB = "https://example.com/jobs/software-engineer?location=canada";

    const expectedA = "custom:https://example.com/jobs/software-engineer?location=us";
    const expectedB = "custom:https://example.com/jobs/software-engineer?location=canada";

    // Act
    const resultA = getCustomKey(urlA);
    const resultB = getCustomKey(urlB);

    // Assert
    expect(resultA).toBe(expectedA);
    expect(resultB).toBe(expectedB);
    expect(resultA).not.toBe(resultB);
  });

  it("keeps an empty question mark in fallback when there are no query params", () => {
    // Arrange
    const url = "https://example.com/jobs/software-engineer";
    const expected = "custom:https://example.com/jobs/software-engineer?";

    // Act
    const result = getCustomKey(url);

    // Assert
    expect(result).toBe(expected);
  });
});
