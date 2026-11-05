import { beforeEach, describe, expect, it, vi } from "vitest";

const dataMocks = vi.hoisted(() => ({
  jobs: {
    loadInFileOrder: vi.fn().mockResolvedValue([]),
    replace: vi.fn().mockResolvedValue(undefined),
  },
  opportunities: {
    load: vi.fn().mockResolvedValue([]),
    replace: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/store", () => dataMocks);

import type { Company } from "@/types";

import { remapStoredCompanyNames } from "../refresh";

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
    dataMocks.jobs.loadInFileOrder.mockReset().mockResolvedValue([]);
    dataMocks.opportunities.load.mockReset().mockResolvedValue([]);
    dataMocks.jobs.replace.mockReset().mockResolvedValue(undefined);
    dataMocks.opportunities.replace.mockReset().mockResolvedValue(undefined);
  });

  it("rewrites tenant company names with the same capitalization as fetch", async () => {
    dataMocks.jobs.loadInFileOrder.mockResolvedValue([
      { company: "globalhr", role: "Intern", link: rtxJob, location: "CT" },
      { company: "rtx", role: "Engineer", link: rtxJob, location: "CT" },
    ]);
    dataMocks.opportunities.load.mockResolvedValue([
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

    expect(dataMocks.jobs.replace).toHaveBeenCalledWith([
      { company: "Rtx", role: "Intern", link: rtxJob, location: "CT" },
      { company: "Rtx", role: "Engineer", link: rtxJob, location: "CT" },
    ]);
    expect(dataMocks.opportunities.replace).toHaveBeenCalledWith([
      {
        company: "Rtx",
        role: "Engineer",
        link: rtxJob,
        location: "CT",
        postedAt: "2026-06-19T17:14:24.202Z",
        expired: false,
      },
    ]);
  });

  it("leaves pretty API company names and already-capitalized rows alone", async () => {
    const greenhouseJob = "https://boards.greenhouse.io/andurilindustries/jobs/1";
    dataMocks.jobs.loadInFileOrder.mockResolvedValue([
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
    expect(dataMocks.jobs.replace).not.toHaveBeenCalled();
    expect(dataMocks.opportunities.replace).not.toHaveBeenCalled();
  });

  it("rewrites a career-site alias hostname to the Workday company it fronts", async () => {
    const dexcom: Company = {
      name: "dexcom",
      ats: "workday",
      identifier: "dexcom-dexcom",
      domain: "https://dexcom.wd1.myworkdayjobs.com/Dexcom",
      page: "https://dexcom.wd1.myworkdayjobs.com/wday/cxs/dexcom/Dexcom/jobs",
      urls: [],
    };
    const dexcomJob = "https://careers.dexcom.com/careers/job/37990370";

    dataMocks.jobs.loadInFileOrder.mockResolvedValue([
      { company: "careers.dexcom.com", role: "Intern", link: dexcomJob, location: "CA" },
    ]);

    await expect(remapStoredCompanyNames([dexcom])).resolves.toEqual({
      jobs: 1,
      opportunities: 0,
    });
    expect(dataMocks.jobs.replace).toHaveBeenCalledWith([
      { company: "Dexcom", role: "Intern", link: dexcomJob, location: "CA" },
    ]);
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

    dataMocks.jobs.loadInFileOrder.mockResolvedValue([
      { company: "careers.arm.com", role: "Engineer", link: armJob, location: "Cambridge" },
    ]);
    dataMocks.opportunities.load.mockResolvedValue([
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

    expect(dataMocks.jobs.replace).toHaveBeenCalledWith([
      { company: "Arm", role: "Engineer", link: armJob, location: "Cambridge" },
    ]);
    expect(dataMocks.opportunities.replace).toHaveBeenCalledWith([
      {
        company: "Arm",
        role: "Engineer",
        link: armJob,
        location: "Cambridge",
        postedAt: "2026-08-20T20:13:26.154Z",
        expired: false,
      },
    ]);
  });
});
