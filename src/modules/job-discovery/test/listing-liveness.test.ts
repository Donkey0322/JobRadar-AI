import { describe, expect, it } from "vitest";

import { partitionUrlsByListedKeys } from "../listing-liveness";

describe("partitionUrlsByListedKeys", () => {
  it("keeps URLs whose job key is on the company listing", () => {
    const listed = "https://boards.greenhouse.io/acme/jobs/1";
    const missing = "https://boards.greenhouse.io/acme/jobs/2";

    expect(partitionUrlsByListedKeys([listed, missing], new Set(["greenhouse:1"]))).toEqual({
      listed: [listed],
      unverified: [missing],
    });
  });

  it("matches sibling URLs that share a job key", () => {
    const stored = "https://acme.example/careers/software-engineer?gh_jid=1";

    expect(partitionUrlsByListedKeys([stored], new Set(["greenhouse:1"]))).toEqual({
      listed: [stored],
      unverified: [],
    });
  });

  it("sends every URL to JD fetch when the listing cannot be retrieved", () => {
    const urls = ["https://boards.greenhouse.io/acme/jobs/1"];

    expect(partitionUrlsByListedKeys(urls, null)).toEqual({
      listed: [],
      unverified: urls,
    });
  });
});
