import { describe, expect, it } from "vitest";

import type { Opportunity } from "@/types";

import { groupUrlsByKey } from "@/utils/job-key";

import { deduplicateOpportunities, syncExpiredFlags } from "../dedup";

function opportunity(link: string, overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    company: "Acme",
    role: "Software Engineer",
    link,
    location: "Remote",
    postedAt: "2026-06-19T17:14:24.203Z",
    expired: false,
    ...overrides,
  };
}

const klaSearch =
  "https://kla.wd1.myworkdayjobs.com/search/job/Milpitas-CA/Software-Engineer_2637811-1";
const klaUr = "https://kla.wd1.myworkdayjobs.com/ur/job/Milpitas-CA/Software-Engineer_2637811";
const otherJob = "https://boards.greenhouse.io/acme/jobs/123456";

describe("syncExpiredFlags", () => {
  it("keeps a row expired when no live URL shares its job key", () => {
    const job = opportunity(klaSearch, { expired: true });

    expect(syncExpiredFlags([job], groupUrlsByKey([otherJob]))).toEqual([
      { ...job, expired: true },
    ]);
  });

  it("does not resurrect an expired row from an exact-URL miss when a sibling key is live", () => {
    const job = opportunity(klaSearch, { expired: true });

    expect(syncExpiredFlags([job], groupUrlsByKey([klaUr]))).toEqual([
      { ...job, expired: false, link: klaUr },
    ]);
  });

  it("keeps the stored link when that exact URL is still live", () => {
    const job = opportunity(klaSearch, { expired: true });

    expect(syncExpiredFlags([job], groupUrlsByKey([klaSearch, klaUr]))).toEqual([
      { ...job, expired: false, link: klaSearch },
    ]);
  });

  it("expires an active row whose key disappeared from urls", () => {
    const job = opportunity(klaSearch, { expired: false });

    expect(syncExpiredFlags([job], groupUrlsByKey([otherJob]))).toEqual([
      { ...job, expired: true },
    ]);
  });
});

describe("deduplicateOpportunities", () => {
  it("prefers the active copy when the same key is both expired and live", () => {
    const expired = opportunity(klaSearch, {
      expired: true,
      postedAt: "2026-08-01T00:00:00.000Z",
    });
    const active = opportunity(klaUr, {
      expired: false,
      postedAt: "2026-06-01T00:00:00.000Z",
    });

    expect(deduplicateOpportunities([expired, active])).toEqual([active]);
  });
});
