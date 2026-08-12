import { describe, expect, it } from "vitest";

import { CUSTOM_COMPANY_DOMAINS, parseCustomCompanyIdentifier } from "../company-tacker/ats";

import {
  getAshbyKey,
  getCustomKey,
  getEightfoldKey,
  getGreenhouseKey,
  getIcimsKey,
  getLeverKey,
  getOracleKey,
  getSmartRecruitersKey,
  getWorkdayKey,
} from "./ats";

describe.each(Object.entries(CUSTOM_COMPANY_DOMAINS))(
  "custom company matcher: %s",
  (identifier, domain) => {
    it(`matches ${domain} using production matcher logic`, () => {
      expect(parseCustomCompanyIdentifier(new URL(`https://${domain}/careers`))).toBe(identifier);
    });
  }
);

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
  it("extracts workday id after the last underscore with tenant", () => {
    // Arrange
    const url =
      "https://intel.wd1.myworkdayjobs.com/en-us/external/job/US-Arizona-Phoenix/AI-Software-Engineering-Intern_JR0282641";
    const expected = "workday:intel:JR0282641";

    // Act
    const result = getWorkdayKey(url);

    // Assert
    expect(result).toBe(expected);
  });

  it("extracts workday id before query string with tenant", () => {
    // Arrange
    const url =
      "https://company.wd1.myworkdayjobs.com/external/job/New-York/Software-Engineer_R-12345?source=LinkedIn";
    const expected = "workday:company:R-12345";

    // Act
    const result = getWorkdayKey(url);

    // Assert
    expect(result).toBe(expected);
  });

  it("removes trailing workday duplicate suffix like -1", () => {
    // Arrange
    const url =
      "https://company.wd1.myworkdayjobs.com/external/job/New-York/Software-Engineer_R-12345-1";
    const expected = "workday:company:R-12345";

    // Act
    const result = getWorkdayKey(url);

    // Assert
    expect(result).toBe(expected);
  });

  it("keeps different tenants with the same requisition id distinct", () => {
    // Arrange
    const crowdstrike =
      "https://crowdstrike.wd5.myworkdayjobs.com/crowdstrikecareers/job/Romania---Bucharest/Software-Engineer-GenAI--Hybrid--ROU-_R29013";
    const premera =
      "https://premera.wd5.myworkdayjobs.com/premera/job/Telecommuter/Software-Developer-IV-Quality-Engineering_R29013";

    // Act
    const crowdstrikeKey = getWorkdayKey(crowdstrike);
    const premeraKey = getWorkdayKey(premera);

    // Assert
    expect(crowdstrikeKey).toBe("workday:crowdstrike:R29013");
    expect(premeraKey).toBe("workday:premera:R29013");
    expect(crowdstrikeKey).not.toBe(premeraKey);
  });

  it("uses recruiting tenant for myworkdaysite.com urls", () => {
    // Arrange
    const url =
      "https://wd3.myworkdaysite.com/recruiting/magna/Magna/job/Bangalore-IN/Software-Engineer_R00210727";
    const expected = "workday:magna:R00210727";

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

describe("getEightfoldKey", () => {
  it("extracts numeric id from /job/:id", () => {
    // Arrange
    const url = new URL("https://apply.careers.microsoft.com/careers/job/123456/software-engineer");
    const expected = "eightfold:123456";

    // Act
    const result = getEightfoldKey(url);

    // Assert
    expect(result).toBe(expected);
  });

  it("is case insensitive for /job", () => {
    // Arrange
    const url = new URL("https://apply.careers.microsoft.com/careers/JOB/123456/software-engineer");
    const expected = "eightfold:123456";

    // Act
    const result = getEightfoldKey(url);

    // Assert
    expect(result).toBe(expected);
  });

  it("uses 8fold_id query param when present", () => {
    // Arrange
    const url = new URL(
      "https://apply.careers.microsoft.com/careers/job/1970393556914839?domain=microsoft.com&8fold_id=1970393556914839"
    );
    const expected = "eightfold:1970393556914839";

    // Act
    const result = getEightfoldKey(url);

    // Assert
    expect(result).toBe(expected);
  });

  it("uses pid query param when there is no /job/:id", () => {
    // Arrange
    const url = new URL(
      "https://apply.careers.microsoft.com/careers?query=intern&start=0&location=united+states&sort_by=relevance&filter_include_remote=1&filter_include_relocation=0&pid=1970393556922922"
    );
    const expected = "eightfold:1970393556922922";

    // Act
    const result = getEightfoldKey(url);

    // Assert
    expect(result).toBe(expected);
  });

  it("returns null when no id exists", () => {
    // Arrange
    const url = new URL("https://apply.careers.microsoft.com/careers?query=intern");
    const expected = null;

    // Act
    const result = getEightfoldKey(url);

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

  it("uses custom company identifier with numeric pathname id and hyphen", () => {
    // Arrange
    const url =
      "https://jobs.apple.com/en-us/details/200670523-0836/screening-integration-engineer-watch-software?team=SFTWR";
    const expected = "apple:200670523-0836";

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
