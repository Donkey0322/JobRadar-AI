import { describe, expect, it } from "vitest";

import { getJobKey, isKnownJob, toJobKeySet } from ".";

describe("job key sets", () => {
  it("converts URL aliases into one canonical key", () => {
    const keys = toJobKeySet([
      "https://boards.greenhouse.io/acme/jobs/123456",
      "https://acme.example/careers/software-engineer?gh_jid=123456",
    ]);

    expect(keys).toEqual(new Set(["greenhouse:123456"]));
  });

  it("detects a known job by key instead of exact URL", () => {
    const knownKeys = new Set([
      getJobKey("https://company.wd1.myworkdayjobs.com/jobs/role_R-12345-1"),
    ]);

    expect(
      isKnownJob("https://company.wd1.myworkdayjobs.com/en-US/jobs/another-role_R-12345", knownKeys)
    ).toBe(true);
  });
});
