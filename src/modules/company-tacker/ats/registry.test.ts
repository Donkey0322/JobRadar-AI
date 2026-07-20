import { beforeEach, describe, expect, it, vi } from "vitest";

const dataMocks = vi.hoisted(() => ({
  loadCompanies: vi.fn().mockResolvedValue([]),
  saveCompanies: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/utils/data", () => dataMocks);
vi.mock("@/utils/dev", () => ({
  renderProgress: vi.fn(),
}));
vi.mock("@/utils/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import type { ATS, Company } from "../type";

import { buildCompanyList } from "../company";
import { fetchJobs } from "../fetch";

import { ashbyFetcher } from "./ashby";
import { ATSFetcher } from "./class";
import { customFetcher } from "./custom";
import { eightfoldFetcher } from "./eightfold";
import { greenhouseFetcher } from "./greenhouse";
import { icimsFetcher } from "./icims";
import { leverFetcher } from "./lever";
import { oracleCloudFetcher } from "./oraclecloud";
import { phenomFetcher } from "./phenom";
import { atsFetchers, getATSFetcher } from "./registry";
import { smartRecruitersFetcher } from "./smart";
import { workdayFetcher } from "./workday";

const allATS = [
  "ashby",
  "eightfold",
  "greenhouse",
  "icims",
  "lever",
  "oraclecloud",
  "phenom",
  "smartrecruiters",
  "workday",
  "custom",
] satisfies ATS[];

describe("ATS fetcher registry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    dataMocks.loadCompanies.mockResolvedValue([]);
    dataMocks.saveCompanies.mockResolvedValue(undefined);
  });

  it("contains every ATS exactly once and returns its singleton", () => {
    expect(Object.keys(atsFetchers).sort()).toEqual([...allATS].sort());
    expect(atsFetchers).toEqual({
      ashby: ashbyFetcher,
      eightfold: eightfoldFetcher,
      greenhouse: greenhouseFetcher,
      icims: icimsFetcher,
      lever: leverFetcher,
      oraclecloud: oracleCloudFetcher,
      phenom: phenomFetcher,
      smartrecruiters: smartRecruitersFetcher,
      workday: workdayFetcher,
      custom: customFetcher,
    });

    for (const ats of allATS) {
      const fetcher = getATSFetcher(ats);
      const prototype = Object.getPrototypeOf(fetcher) as object;

      expect(fetcher).toBe(atsFetchers[ats]);
      expect(fetcher).toBeInstanceOf(ATSFetcher);
      expect(fetcher.ats).toBe(ats);
      expect(Object.keys(fetcher)).toEqual(["ats"]);
      expect(prototype).toHaveProperty("getJobsFromResponse", expect.any(Function));
      expect(prototype).toHaveProperty("getJobLink", expect.any(Function));
      expect(prototype).toHaveProperty("normalizeJob", expect.any(Function));
    }
  });

  it("dispatches company formation through the classified adapter", async () => {
    const company: Company = {
      name: "example.com",
      ats: "custom",
      identifier: "example.com",
      domain: "https://example.com",
      page: "",
      urls: [],
    };
    const formCompany = vi.spyOn(customFetcher, "formCompany").mockReturnValue(company);

    await expect(buildCompanyList(["https://example.com/jobs/1"])).resolves.toEqual([
      {
        ...company,
        urls: ["https://example.com/jobs/1"],
      },
    ]);
    expect(formCompany).toHaveBeenCalledWith(new URL("https://example.com/jobs/1"));
  });

  it("dispatches fetches and retains final job-key deduplication", async () => {
    const company: Company = {
      name: "acme",
      ats: "lever",
      identifier: "acme",
      domain: "https://jobs.lever.co",
      page: "https://api.lever.co/v0/postings/acme",
      urls: [],
    };
    const existing = "https://jobs.lever.co/acme/known";
    const discovered = "https://jobs.lever.co/acme/new";
    const fetch = vi.spyOn(leverFetcher, "fetch").mockResolvedValue([
      { company: "Acme", role: "Known", link: existing, location: "Remote" },
      { company: "Acme", role: "New", link: discovered, location: "Remote" },
    ]);
    const urls = new Set([existing]);

    await expect(fetchJobs(company, urls)).resolves.toEqual([
      { company: "Acme", role: "New", link: discovered, location: "Remote" },
    ]);
    expect(fetch).toHaveBeenCalledWith(company, urls, expect.any(AbortSignal));
  });
});
