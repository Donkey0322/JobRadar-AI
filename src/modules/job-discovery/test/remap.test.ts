import { beforeEach, describe, expect, it, vi } from "vitest";

const dataMocks = vi.hoisted(() => ({
  loadJobsInFileOrder: vi.fn().mockResolvedValue([]),
  loadOpportunities: vi.fn().mockResolvedValue([]),
  saveJob: vi.fn().mockResolvedValue(undefined),
  saveOpportunities: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/utils/data", () => dataMocks);

import type { Company } from "@/types";

import { remapStoredCompanyNames } from "../remap";

const rtx: Company = {
  name: "rtx",
  ats: "workday",
  identifier: "rtx-rec_rtx_ext_gateway",
  domain: "https://globalhr.wd5.myworkdayjobs.com/rec_rtx_ext_gateway",
  page: "https://globalhr.wd5.myworkdayjobs.com/wday/cxs/globalhr/rec_rtx_ext_gateway/jobs",
  urls: [],
};

const rtxJob =
  "https://globalhr.wd5.myworkdayjobs.com/rec_rtx_ext_gateway/job/US-CT-EAST-HARTFORD-G/Intern_01832259";

describe("remapStoredCompanyNames", () => {
  beforeEach(() => {
    dataMocks.loadJobsInFileOrder.mockReset().mockResolvedValue([]);
    dataMocks.loadOpportunities.mockReset().mockResolvedValue([]);
    dataMocks.saveJob.mockReset().mockResolvedValue(undefined);
    dataMocks.saveOpportunities.mockReset().mockResolvedValue(undefined);
  });

  it("rewrites tenant company names with the same capitalization as fetch", async () => {
    dataMocks.loadJobsInFileOrder.mockResolvedValue([
      { company: "globalhr", role: "Intern", link: rtxJob, location: "CT" },
      { company: "rtx", role: "Engineer", link: rtxJob, location: "CT" },
    ]);
    dataMocks.loadOpportunities.mockResolvedValue([
      {
        company: "Globalhr",
        role: "Engineer",
        link: rtxJob,
        location: "CT",
        postedAt: "2026-06-19T17:14:24.202Z",
        expired: false,
      },
    ]);

    await expect(remapStoredCompanyNames([rtx])).resolves.toEqual({
      jobs: 2,
      opportunities: 1,
    });

    expect(dataMocks.saveJob).toHaveBeenCalledWith(
      [
        { company: "Rtx", role: "Intern", link: rtxJob, location: "CT" },
        { company: "Rtx", role: "Engineer", link: rtxJob, location: "CT" },
      ],
      true
    );
    expect(dataMocks.saveOpportunities).toHaveBeenCalledWith(
      [
        {
          company: "Rtx",
          role: "Engineer",
          link: rtxJob,
          location: "CT",
          postedAt: "2026-06-19T17:14:24.202Z",
          expired: false,
        },
      ],
      true
    );
  });

  it("leaves pretty API company names and already-capitalized rows alone", async () => {
    const greenhouseJob = "https://boards.greenhouse.io/andurilindustries/jobs/1";
    dataMocks.loadJobsInFileOrder.mockResolvedValue([
      { company: "Rtx", role: "Intern", link: rtxJob, location: "CT" },
      {
        company: "Anduril Industries",
        role: "Engineer",
        link: greenhouseJob,
        location: "CA",
      },
    ]);

    await expect(remapStoredCompanyNames([rtx])).resolves.toEqual({
      jobs: 0,
      opportunities: 0,
    });
    expect(dataMocks.saveJob).not.toHaveBeenCalled();
    expect(dataMocks.saveOpportunities).not.toHaveBeenCalled();
  });

  it("rewrites hostname company names after a Radancy display-name remap", async () => {
    const arm: Company = {
      name: "arm",
      ats: "radancy",
      identifier: "careers.arm.com",
      domain: "https://careers.arm.com",
      page: "https://careers.arm.com/search-jobs/resultspost",
      urls: [],
    };
    const armJob =
      "https://careers.arm.com/job/cambridge/analytics-app-developer-12-month-ftc/33099/93494555328";

    dataMocks.loadJobsInFileOrder.mockResolvedValue([
      { company: "careers.arm.com", role: "Engineer", link: armJob, location: "Cambridge" },
    ]);
    dataMocks.loadOpportunities.mockResolvedValue([
      {
        company: "careers.arm.com",
        role: "Engineer",
        link: armJob,
        location: "Cambridge",
        postedAt: "2026-08-20T20:13:26.154Z",
        expired: false,
      },
    ]);

    await expect(remapStoredCompanyNames([arm])).resolves.toEqual({
      jobs: 1,
      opportunities: 1,
    });

    expect(dataMocks.saveJob).toHaveBeenCalledWith(
      [{ company: "Arm", role: "Engineer", link: armJob, location: "Cambridge" }],
      true
    );
    expect(dataMocks.saveOpportunities).toHaveBeenCalledWith(
      [
        {
          company: "Arm",
          role: "Engineer",
          link: armJob,
          location: "Cambridge",
          postedAt: "2026-08-20T20:13:26.154Z",
          expired: false,
        },
      ],
      true
    );
  });
});
