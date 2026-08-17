import { beforeEach, describe, expect, it, vi } from "vitest";

const dataMocks = vi.hoisted(() => ({
  loadCompanies: vi.fn().mockResolvedValue([]),
  saveCompanies: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/utils/data", () => dataMocks);
vi.mock("@/utils/dev", () => ({
  renderProgress: vi.fn(),
  startProgress: vi.fn(),
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
import discoverJobs, { fetchJobs } from "../fetch";

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

import { toJobKeySet } from "@/modules/job-dedup";

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
      expect(prototype).toHaveProperty("companyKeyFromUrl", expect.any(Function));
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

  it("groups URLs by company key before calling formCompany", async () => {
    const company: Company = {
      name: "apply.careers.microsoft.com",
      ats: "eightfold",
      identifier: "apply.careers.microsoft.com",
      domain: "microsoft.com",
      page: "https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com",
      urls: [],
    };
    const formCompany = vi.spyOn(eightfoldFetcher, "formCompany").mockResolvedValue(company);

    const urls = [
      "https://apply.careers.microsoft.com/careers/job/1?domain=microsoft.com&8fold_id=1",
      "https://apply.careers.microsoft.com/careers/job/2?domain=microsoft.com&8fold_id=2",
      "https://apply.careers.microsoft.com/careers/job/3?domain=microsoft.com&8fold_id=3",
    ];

    await expect(buildCompanyList(urls)).resolves.toEqual([
      {
        ...company,
        urls,
      },
    ]);
    expect(formCompany).toHaveBeenCalledTimes(1);
    expect(formCompany).toHaveBeenCalledWith(new URL(urls[0]));
  });

  it("replaces stale Workday identifiers when the tenant is remapped", async () => {
    const stale: Company = {
      name: "globalhr",
      ats: "workday",
      identifier: "globalhr-rec_rtx_ext_gateway",
      domain: "https://globalhr.wd5.myworkdayjobs.com/rec_rtx_ext_gateway",
      page: "https://globalhr.wd5.myworkdayjobs.com/wday/cxs/globalhr/rec_rtx_ext_gateway/jobs",
      urls: [
        "https://globalhr.wd5.myworkdayjobs.com/rec_rtx_ext_gateway/job/US-CT/Intern_1",
      ],
    };
    dataMocks.loadCompanies.mockResolvedValue([stale]);

    const result = await buildCompanyList(stale.urls);

    expect(result).toEqual([
      expect.objectContaining({
        name: "rtx",
        identifier: "rtx-rec_rtx_ext_gateway",
        urls: stale.urls,
      }),
    ]);
    expect(result.some((company) => company.identifier.startsWith("globalhr"))).toBe(false);
  });

  it("keeps existing companies that have no job URLs without reforming them", async () => {
    const ghost: Company = {
      name: "acme",
      ats: "lever",
      identifier: "acme",
      domain: "https://jobs.lever.co",
      page: "https://api.lever.co/v0/postings/acme?mode=json",
      urls: [],
    };
    dataMocks.loadCompanies.mockResolvedValue([ghost]);

    await expect(buildCompanyList([])).resolves.toEqual([
      {
        ...ghost,
        urls: [],
      },
    ]);
  });

  it("keeps distinct company keys as separate formCompany calls", async () => {
    const acme: Company = {
      name: "acme",
      ats: "lever",
      identifier: "acme",
      domain: "https://jobs.lever.co",
      page: "https://api.lever.co/v0/postings/acme?mode=json",
      urls: [],
    };
    const beta: Company = {
      name: "beta",
      ats: "lever",
      identifier: "beta",
      domain: "https://jobs.lever.co",
      page: "https://api.lever.co/v0/postings/beta?mode=json",
      urls: [],
    };
    const formCompany = vi
      .spyOn(leverFetcher, "formCompany")
      .mockImplementation((url) => (url.pathname.startsWith("/acme") ? acme : beta));

    const result = await buildCompanyList([
      "https://jobs.lever.co/acme/1",
      "https://jobs.lever.co/acme/2",
      "https://jobs.lever.co/beta/1",
    ]);

    expect(formCompany).toHaveBeenCalledTimes(2);
    expect(result).toEqual(
      expect.arrayContaining([
        { ...acme, urls: ["https://jobs.lever.co/acme/1", "https://jobs.lever.co/acme/2"] },
        { ...beta, urls: ["https://jobs.lever.co/beta/1"] },
      ])
    );
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
    const knownKeys = toJobKeySet([existing]);

    await expect(fetchJobs(company, knownKeys)).resolves.toEqual([
      { company: "Acme", role: "New", link: discovered, location: "Remote" },
    ]);
    expect(fetch).toHaveBeenCalledWith(company, knownKeys, expect.any(AbortSignal));
  });

  it("converts company URLs to keys before dispatching an adapter", async () => {
    const existing = "https://jobs.lever.co/acme/known";
    const company: Company = {
      name: "acme",
      ats: "lever",
      identifier: "acme",
      domain: "https://jobs.lever.co",
      page: "https://api.lever.co/v0/postings/acme",
      urls: [existing],
    };
    dataMocks.loadCompanies.mockResolvedValue([company]);
    const fetch = vi.spyOn(leverFetcher, "fetch").mockResolvedValue([]);

    await expect(discoverJobs()).resolves.toEqual([]);

    expect(fetch).toHaveBeenCalledWith(company, new Set(["lever:known"]), expect.any(AbortSignal));
  });
});
