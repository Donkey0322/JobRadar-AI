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

import type { ATS } from "@/modules/ats/types";
import type { Company } from "@/types";

import { Employer } from "../employer";
import { ashbyFetcher } from "../listing/ashby";
import { bambooHRFetcher } from "../listing/bamboohr";
import { customFetcher } from "../listing/custom";
import { eightfoldFetcher } from "../listing/eightfold";
import { greenhouseFetcher } from "../listing/greenhouse";
import { icimsFetcher } from "../listing/icims";
import { jazzHRFetcher } from "../listing/jazzhr";
import { leverFetcher } from "../listing/lever";
import { noneFetcher } from "../listing/none";
import { oracleCloudFetcher } from "../listing/oraclecloud";
import { phenomFetcher } from "../listing/phenom";
import { pinpointFetcher } from "../listing/pinpoint";
import { radancyFetcher } from "../listing/radancy";
import { ripplingFetcher } from "../listing/rippling";
import { smartRecruitersFetcher } from "../listing/smart";
import { successFactorsFetcher } from "../listing/successfactors";
import { workdayFetcher } from "../listing/workday";
import { employers } from "../registry";

import { buildCompanyList } from "@/modules/employer/build";

const allATS = [
  "ashby",
  "bamboohr",
  "eightfold",
  "greenhouse",
  "icims",
  "jazzhr",
  "lever",
  "oraclecloud",
  "phenom",
  "pinpoint",
  "radancy",
  "rippling",
  "smartrecruiters",
  "successfactors",
  "workday",
  "custom",
  "none",
] satisfies ATS[];

describe("ATS fetcher registry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    dataMocks.loadCompanies.mockResolvedValue([]);
    dataMocks.saveCompanies.mockResolvedValue(undefined);
  });

  it("contains every ATS exactly once and returns its singleton", () => {
    expect(Object.keys(employers).sort()).toEqual([...allATS].sort());
    expect(employers).toEqual({
      ashby: ashbyFetcher,
      bamboohr: bambooHRFetcher,
      eightfold: eightfoldFetcher,
      greenhouse: greenhouseFetcher,
      icims: icimsFetcher,
      jazzhr: jazzHRFetcher,
      lever: leverFetcher,
      oraclecloud: oracleCloudFetcher,
      phenom: phenomFetcher,
      pinpoint: pinpointFetcher,
      radancy: radancyFetcher,
      rippling: ripplingFetcher,
      smartrecruiters: smartRecruitersFetcher,
      successfactors: successFactorsFetcher,
      workday: workdayFetcher,
      custom: customFetcher,
      none: noneFetcher,
    });

    for (const ats of allATS) {
      const fetcher = employers[ats];
      const prototype = Object.getPrototypeOf(fetcher) as object;

      expect(fetcher).toBe(employers[ats]);
      expect(fetcher).toBeInstanceOf(Employer);
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
      ats: "none",
      identifier: "example.com",
      domain: "https://example.com",
      page: "",
      urls: [],
    };
    const formCompany = vi.spyOn(noneFetcher, "formCompany").mockReturnValue(company);

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

  it("keeps the stored name of a company it reforms from job URLs", async () => {
    const url = "https://job-boards.greenhouse.io/imc/jobs/4940448101";
    const stored: Company = {
      name: "IMC",
      ats: "greenhouse",
      identifier: "imc",
      domain: "https://job-boards.greenhouse.io",
      page: "https://boards-api.greenhouse.io/v1/boards/imc/jobs",
      urls: [url],
    };
    dataMocks.loadCompanies.mockResolvedValue([stored]);
    vi.spyOn(greenhouseFetcher, "formCompany").mockResolvedValue({
      ...stored,
      name: "imc",
      urls: [],
    });

    await expect(buildCompanyList([url])).resolves.toEqual([stored]);
  });

  it("replaces stale Workday identifiers when the tenant is remapped", async () => {
    const stale: Company = {
      name: "globalhr",
      ats: "workday",
      identifier: "globalhr-rec_rtx_ext_gateway",
      domain: "https://globalhr.wd5.myworkdayjobs.com/rec_rtx_ext_gateway",
      page: "https://globalhr.wd5.myworkdayjobs.com/wday/cxs/globalhr/rec_rtx_ext_gateway/jobs",
      urls: ["https://globalhr.wd5.myworkdayjobs.com/rec_rtx_ext_gateway/job/US-CT/Intern_1"],
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

  it("upgrades a url-less custom row whose domain is now an ATS board", async () => {
    const legacy: Company = {
      name: "mujin.bamboohr.com",
      ats: "custom",
      identifier: "mujin.bamboohr.com",
      domain: "https://mujin.bamboohr.com",
      page: "",
      urls: [],
    };
    const upgraded: Company = {
      name: "Mujin",
      ats: "bamboohr",
      identifier: "mujin",
      domain: "https://mujin.bamboohr.com",
      page: "https://mujin.bamboohr.com/careers/list",
      urls: [],
    };
    dataMocks.loadCompanies.mockResolvedValue([legacy]);
    const formCompany = vi.spyOn(bambooHRFetcher, "formCompany").mockResolvedValue(upgraded);

    await expect(buildCompanyList([])).resolves.toEqual([upgraded]);
    expect(formCompany).toHaveBeenCalledWith(new URL(legacy.domain));
  });

  describe("aliased career sites", () => {
    const homeDepot: Company = {
      name: "homedepot",
      ats: "workday",
      identifier: "homedepot-careerdepot",
      domain: "https://homedepot.wd5.myworkdayjobs.com/CareerDepot",
      page: "https://homedepot.wd5.myworkdayjobs.com/wday/cxs/homedepot/CareerDepot/jobs",
      urls: [],
    };
    const siteUrl = "https://careers.homedepot.com/job/22712345/software-engineer";

    it("drops a stored none row for a site whose board is tracked elsewhere", async () => {
      dataMocks.loadCompanies.mockResolvedValue([
        homeDepot,
        {
          name: "careers.homedepot.com",
          ats: "none",
          identifier: "careers.homedepot.com",
          domain: "https://careers.homedepot.com",
          page: "",
          urls: [],
        },
      ]);

      await expect(buildCompanyList([])).resolves.toEqual([homeDepot]);
    });

    it("keeps a stored none row for an aliased site until its board is stored", async () => {
      const site: Company = {
        name: "careers.homedepot.com",
        ats: "none",
        identifier: "careers.homedepot.com",
        domain: "https://careers.homedepot.com",
        page: "",
        urls: [],
      };
      dataMocks.loadCompanies.mockResolvedValue([site]);

      await expect(buildCompanyList([])).resolves.toEqual([site]);
    });

    it("files new site URLs under the tracked board instead of a none row", async () => {
      dataMocks.loadCompanies.mockResolvedValue([homeDepot]);
      const noneForm = vi.spyOn(noneFetcher, "formCompany");

      await expect(buildCompanyList([siteUrl])).resolves.toEqual([
        { ...homeDepot, urls: [siteUrl] },
      ]);
      expect(noneForm).not.toHaveBeenCalled();
    });

    it("keeps a tracked board whose only stored URLs are site URLs", async () => {
      dataMocks.loadCompanies.mockResolvedValue([{ ...homeDepot, urls: [siteUrl] }]);
      const noneForm = vi.spyOn(noneFetcher, "formCompany");

      await expect(buildCompanyList([siteUrl])).resolves.toEqual([
        { ...homeDepot, urls: [siteUrl] },
      ]);
      expect(noneForm).not.toHaveBeenCalled();
    });

    it("still forms a none row when the tracked board is gone", async () => {
      dataMocks.loadCompanies.mockResolvedValue([]);

      const [company] = await buildCompanyList([siteUrl]);

      expect(company).toMatchObject({ ats: "none", urls: [siteUrl] });
    });
  });

  it("keeps url-less none rows whose domain is still unread", async () => {
    const unread: Company = {
      name: "Acme",
      ats: "none",
      identifier: "careers.acme.com",
      domain: "https://careers.acme.com",
      page: "",
      urls: [],
    };
    dataMocks.loadCompanies.mockResolvedValue([unread]);
    const formCompany = vi.spyOn(noneFetcher, "formCompany");

    await expect(buildCompanyList([])).resolves.toEqual([unread]);
    expect(formCompany).not.toHaveBeenCalled();
  });

  it("repairs a stored iCIMS row that points at the retired api.icims.com feed", async () => {
    const stale: Company = {
      name: "atlassian",
      ats: "icims",
      identifier: "atlassian",
      domain: "https://campus-globalcareers-atlassian.icims.com",
      page: "https://api.icims.com/v1/companies/atlassian/jobs",
      urls: [],
    };
    dataMocks.loadCompanies.mockResolvedValue([stale]);

    await expect(buildCompanyList([])).resolves.toEqual([
      { ...stale, page: "https://campus-globalcareers-atlassian.icims.com/jobs/search" },
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
});
