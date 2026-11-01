import { describe, expect, it } from "vitest";

import { deduplicateJobs, getJobKey, isKnownJob, toJobKeySet } from "..";

describe("job key sets", () => {
  it("converts URL aliases into one canonical key", () => {
    const keys = toJobKeySet([
      "https://boards.greenhouse.io/acme/jobs/123456",
      "https://acme.example/careers/software-engineer?gh_jid=123456",
    ]);

    expect(keys).toEqual(new Set(["greenhouse:123456"]));
  });

  it("treats a Greenhouse board url and gh_jid url as the same job", () => {
    const keys = toJobKeySet([
      "https://job-boards.greenhouse.io/databricks/jobs/6865704002",
      "https://databricks.com/company/careers/open-positions/job?gh_jid=6865704002",
    ]);

    expect(keys).toEqual(new Set(["greenhouse:6865704002"]));
  });

  it("detects a known job by key instead of exact URL", () => {
    const knownKeys = new Set([
      getJobKey("https://company.wd1.myworkdayjobs.com/jobs/role_R-12345-1"),
    ]);

    expect(
      isKnownJob("https://company.wd1.myworkdayjobs.com/en-US/jobs/another-role_R-12345", knownKeys)
    ).toBe(true);
  });

  it("deduplicates URL aliases within the same job batch", () => {
    const first = {
      link: "https://boards.greenhouse.io/acme/jobs/123456",
      role: "Software Engineer",
    };
    const alias = {
      link: "https://acme.example/careers/software-engineer?gh_jid=123456",
      role: "Software Engineer",
    };
    const different = {
      link: "https://boards.greenhouse.io/acme/jobs/654321",
      role: "Data Engineer",
    };

    expect(deduplicateJobs([first, alias, different])).toEqual([first, different]);
  });
});
