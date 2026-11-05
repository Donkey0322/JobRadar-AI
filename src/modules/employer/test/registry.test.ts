import { beforeEach, describe, expect, it, vi } from "vitest";

const dataMocks = vi.hoisted(() => ({
  companies: {
    load: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/store", () => dataMocks);
vi.mock("@/utils/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import type { ATS } from "@/modules/ats/types";
import type { Company } from "@/types";

import { Board } from "../employer";
import { ashbyBoard } from "../listing/ashby";
import { bambooHRBoard } from "../listing/bamboohr";
import { customBoard } from "../listing/custom";
import { eightfoldBoard } from "../listing/eightfold";
import { greenhouseBoard } from "../listing/greenhouse";
import { icimsBoard } from "../listing/icims";
import { jazzHRBoard } from "../listing/jazzhr";
import { leverBoard } from "../listing/lever";
import { noneBoard } from "../listing/none";
import { oracleCloudBoard } from "../listing/oraclecloud";
import { phenomBoard } from "../listing/phenom";
import { pinpointBoard } from "../listing/pinpoint";
import { radancyBoard } from "../listing/radancy";
import { ripplingBoard } from "../listing/rippling";
import { smartRecruitersBoard } from "../listing/smart";
import { successFactorsBoard } from "../listing/successfactors";
import { workdayBoard } from "../listing/workday";
import { boards } from "../registry";

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
    dataMocks.companies.load.mockResolvedValue([]);
    dataMocks.companies.save.mockResolvedValue(undefined);
  });

  it("contains every ATS exactly once and returns its singleton", () => {
    expect(Object.keys(boards).sort()).toEqual([...allATS].sort());
    expect(boards).toEqual({
      ashby: ashbyBoard,
      bamboohr: bambooHRBoard,
      eightfold: eightfoldBoard,
      greenhouse: greenhouseBoard,
      icims: icimsBoard,
      jazzhr: jazzHRBoard,
      lever: leverBoard,
      oraclecloud: oracleCloudBoard,
      phenom: phenomBoard,
      pinpoint: pinpointBoard,
      radancy: radancyBoard,
      rippling: ripplingBoard,
      smartrecruiters: smartRecruitersBoard,
      successfactors: successFactorsBoard,
      workday: workdayBoard,
      custom: customBoard,
      none: noneBoard,
    });

    for (const ats of allATS) {
      const fetcher = boards[ats];
      const prototype = Object.getPrototypeOf(fetcher) as object;

      expect(fetcher).toBe(boards[ats]);
      expect(fetcher).toBeInstanceOf(Board);
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
    const formCompany = vi.spyOn(noneBoard, "formCompany").mockReturnValue(company);

    await expect(buildCompanyList(["https://example.com/jobs/1"])).resolves.toEqual([
      {
        ...company,
        urls: ["https://example.com/jobs/1"],
      },
    ]);
    expect(formCompany).toHaveBeenCalledWith(new URL("https://example.com/jobs/1"));
  });

  it("reports each company group from zero and still builds without a callback", async () => {
    const onProgress = vi.fn();

    const reported = await buildCompanyList(
      ["https://example.com/jobs/1", "https://widgets.example/jobs/2"],
      onProgress
    );
    const silent = await buildCompanyList([
      "https://example.com/jobs/1",
      "https://widgets.example/jobs/2",
    ]);

    expect(onProgress.mock.calls).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
    expect(silent).toEqual(reported);
    expect(reported.map((company) => company.identifier).sort()).toEqual([
      "example.com",
      "widgets.example",
    ]);
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
    const formCompany = vi.spyOn(eightfoldBoard, "formCompany").mockResolvedValue(company);

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
    dataMocks.companies.load.mockResolvedValue([stored]);
    vi.spyOn(greenhouseBoard, "formCompany").mockResolvedValue({
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
    dataMocks.companies.load.mockResolvedValue([stale]);

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
    dataMocks.companies.load.mockResolvedValue([ghost]);

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
    dataMocks.companies.load.mockResolvedValue([legacy]);
    const formCompany = vi.spyOn(bambooHRBoard, "formCompany").mockResolvedValue(upgraded);

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
      dataMocks.companies.load.mockResolvedValue([
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
      dataMocks.companies.load.mockResolvedValue([site]);

      await expect(buildCompanyList([])).resolves.toEqual([site]);
    });

    it("files new site URLs under the tracked board instead of a none row", async () => {
      dataMocks.companies.load.mockResolvedValue([homeDepot]);
      const noneForm = vi.spyOn(noneBoard, "formCompany");

      await expect(buildCompanyList([siteUrl])).resolves.toEqual([
        { ...homeDepot, urls: [siteUrl] },
      ]);
      expect(noneForm).not.toHaveBeenCalled();
    });

    it("keeps a tracked board whose only stored URLs are site URLs", async () => {
      dataMocks.companies.load.mockResolvedValue([{ ...homeDepot, urls: [siteUrl] }]);
      const noneForm = vi.spyOn(noneBoard, "formCompany");

      await expect(buildCompanyList([siteUrl])).resolves.toEqual([
        { ...homeDepot, urls: [siteUrl] },
      ]);
      expect(noneForm).not.toHaveBeenCalled();
    });

    it("still forms a none row when the tracked board is gone", async () => {
      dataMocks.companies.load.mockResolvedValue([]);

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
    dataMocks.companies.load.mockResolvedValue([unread]);
    const formCompany = vi.spyOn(noneBoard, "formCompany");

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
    dataMocks.companies.load.mockResolvedValue([stale]);

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
      .spyOn(leverBoard, "formCompany")
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
