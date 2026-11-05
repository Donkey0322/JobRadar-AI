import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/posting/screening", () => ({
  isTarget: vi.fn(() => true),
  withinDays: vi.fn(() => true),
}));

vi.mock("@/store", () => ({ errorLog: { append: vi.fn() } }));

import { RED_CROSS } from "@/constants/log";

import type { Company } from "@/types";

import { Board } from "../../employer";
import { ashbyBoard } from "../ashby";
import { eightfoldBoard } from "../eightfold";
import { GreenhouseBoard, greenhouseBoard } from "../greenhouse";
import { leverBoard } from "../lever";
import { NoneBoard, noneBoard } from "../none";
import { oracleCloudBoard } from "../oraclecloud";
import { smartRecruitersBoard } from "../smart";

import { toJobKeySet } from "@/modules/ats/job-key";
import { isTarget, withinDays } from "@/modules/posting/screening";
import { errorLog } from "@/store";
import { logger } from "@/utils/logger";

const mockFetch = vi.fn<typeof fetch>();

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Company adapters", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
    vi.mocked(isTarget).mockReset().mockReturnValue(true);
    vi.mocked(withinDays).mockReset().mockReturnValue(true);
    vi.mocked(errorLog.append).mockReset();
  });

  it("exposes Greenhouse and Eightfold through the common base contract", () => {
    expect(greenhouseBoard).toBeInstanceOf(Board);
    expect(greenhouseBoard.ats).toBe("greenhouse");
    expect(eightfoldBoard).toBeInstanceOf(Board);
    expect(eightfoldBoard.ats).toBe("eightfold");
  });

  it("exposes the simple adapters through the common base contract", () => {
    expect(ashbyBoard).toBeInstanceOf(Board);
    expect(ashbyBoard.ats).toBe("ashby");
    expect(leverBoard).toBeInstanceOf(Board);
    expect(leverBoard.ats).toBe("lever");
    expect(oracleCloudBoard).toBeInstanceOf(Board);
    expect(oracleCloudBoard.ats).toBe("oraclecloud");
    expect(smartRecruitersBoard).toBeInstanceOf(Board);
    expect(smartRecruitersBoard.ats).toBe("smartrecruiters");
  });

  it("keeps Greenhouse company formation compatible", async () => {
    const company = await greenhouseBoard.formCompany(
      new URL("https://job-boards.greenhouse.io/acme/jobs/123")
    );

    expect(company).toEqual({
      name: "acme",
      ats: "greenhouse",
      identifier: "acme",
      domain: "https://job-boards.greenhouse.io",
      page: "https://boards-api.greenhouse.io/v1/boards/acme/jobs",
      urls: [],
    });
  });

  it("parses, filters, and normalizes Greenhouse jobs", async () => {
    const company: Company = {
      name: "acme",
      ats: "greenhouse",
      identifier: "acme",
      domain: "https://acme.example",
      page: "https://boards-api.greenhouse.io/v1/boards/acme/jobs",
      urls: [],
    };
    const duplicateUrl = "https://boards.greenhouse.io/acme/jobs/1";
    const knownAlias = "https://acme.example/careers/software-engineer?gh_jid=1";

    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        jobs: [
          {
            title: "Software Engineer",
            absolute_url: duplicateUrl,
            updated_at: new Date().toISOString(),
          },
          {
            company_name: "Acme Inc.",
            title: "Platform Engineer",
            absolute_url: "https://boards.greenhouse.io/acme/jobs/2",
            updated_at: new Date().toISOString(),
            location: { name: "Remote" },
          },
        ],
      })
    );

    await expect(
      greenhouseBoard.fetch(company, toJobKeySet([knownAlias]), AbortSignal.timeout(1000))
    ).resolves.toEqual([
      {
        company: "Acme Inc.",
        role: "Platform Engineer",
        link: "https://boards.greenhouse.io/acme/jobs/2",
        location: "Remote",
      },
    ]);
  });

  it("lists Greenhouse job keys without discover filters", async () => {
    const company: Company = {
      name: "acme",
      ats: "greenhouse",
      identifier: "acme",
      domain: "https://acme.example",
      page: "https://boards-api.greenhouse.io/v1/boards/acme/jobs",
      urls: [],
    };

    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        jobs: [
          {
            title: "Software Engineer",
            absolute_url: "https://boards.greenhouse.io/acme/jobs/1",
            updated_at: new Date().toISOString(),
          },
          {
            title: "Platform Engineer",
            absolute_url: "https://boards.greenhouse.io/acme/jobs/2",
            updated_at: new Date().toISOString(),
          },
        ],
      })
    );

    await expect(
      greenhouseBoard.listJobKeys(company, AbortSignal.timeout(1000))
    ).resolves.toEqual(new Set(["greenhouse:1", "greenhouse:2"]));
  });

  it("names custom Eightfold career hosts from the company domain", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: { positions: [] } }))
      .mockResolvedValueOnce(jsonResponse({ data: { positions: [] } }));

    const microsoft = await eightfoldBoard.formCompany(
      new URL("https://apply.careers.microsoft.com/careers/job/1?domain=microsoft.com&8fold_id=1")
    );
    const caci = await eightfoldBoard.formCompany(
      new URL("https://searchcareers.caci.com/careers/job/1?8fold_id=1")
    );

    expect(microsoft).toMatchObject({
      name: "microsoft",
      identifier: "apply.careers.microsoft.com",
      domain: "microsoft.com",
    });
    expect(caci).toMatchObject({
      name: "caci",
      identifier: "searchcareers.caci.com",
      domain: "caci.com",
    });
    expect(
      eightfoldBoard.companyKeyFromUrl(
        new URL("https://apply.careers.microsoft.com/careers/job/2?8fold_id=2")
      )
    ).toBe("eightfold:apply.careers.microsoft.com");
  });

  it("forms custom Eightfold hosts without a domain query", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: { positions: [] } }));

    await expect(
      eightfoldBoard.formCompany(new URL("https://join.sephora.com/careers/job/790312030968"))
    ).resolves.toMatchObject({
      name: "sephora",
      identifier: "join.sephora.com",
      domain: "sephora.com",
      page: "https://join.sephora.com/api/pcsx/search?domain=sephora.com",
    });
  });

  it("files a custom host under its existing *.eightfold.ai tenant", () => {
    expect(
      eightfoldBoard.companyKeyFromUrl(new URL("https://career.mlp.com/careers/job/755957778821"))
    ).toBe(
      eightfoldBoard.companyKeyFromUrl(
        new URL("https://mlp.eightfold.ai/careers/job/755957583465?domain=mlp.com&8fold_id=1")
      )
    );
  });

  it("keeps Eightfold company formation compatible with Apply fallback", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ message: "PCSX is not enabled for this user." })
    );

    const company = await eightfoldBoard.formCompany(
      new URL("https://acme.eightfold.ai/careers?domain=jobs.acme.com")
    );

    expect(company).toEqual({
      name: "acme",
      ats: "eightfold",
      identifier: "acme",
      domain: "jobs.acme.com",
      page: "https://acme.eightfold.ai/api/apply/v2/jobs?domain=jobs.acme.com",
      urls: [],
    });
  });

  it("switches Eightfold company formation when PCSX returns 403", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ message: "PCSX is not enabled for this user." }, 403)
    );

    const company = await eightfoldBoard.formCompany(
      new URL("https://mlp.eightfold.ai/careers/job/1?domain=mlp.com")
    );

    expect(company.page).toBe("https://mlp.eightfold.ai/api/apply/v2/jobs?domain=mlp.com");
  });

  it("retries the Eightfold Apply API when a stored PCSX page returns 403", async () => {
    const company: Company = {
      name: "mlp",
      ats: "eightfold",
      identifier: "mlp",
      domain: "mlp.com",
      page: "https://mlp.eightfold.ai/api/pcsx/search?domain=mlp.com",
      urls: [],
    };

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ message: "PCSX is not enabled for this user." }, 403))
      .mockResolvedValueOnce(
        jsonResponse({
          positions: [
            {
              id: 42,
              name: "Software Engineer",
              locations: ["New York"],
              t_create: Date.now(),
              canonicalPositionUrl: "https://mlp.eightfold.ai/careers/job/42",
            },
          ],
        })
      );

    const jobs = await eightfoldBoard.fetch(company, new Set(), AbortSignal.timeout(1000));

    expect(jobs).toEqual([
      {
        company: "Mlp",
        role: "Software Engineer",
        link: "https://mlp.eightfold.ai/careers/job/42?domain=mlp.com&8fold_id=42",
        location: "New York",
      },
    ]);
    expect(String(mockFetch.mock.calls[1]?.[0])).toContain("/api/apply/v2/jobs");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("normalizes the Eightfold Apply format and stops on a short page", async () => {
    const company: Company = {
      name: "acme",
      ats: "eightfold",
      identifier: "acme",
      domain: "jobs.acme.com",
      page: "https://acme.eightfold.ai/api/apply/v2/jobs?domain=jobs.acme.com",
      urls: [],
    };
    const now = Date.now();

    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        positions: [
          {
            id: 42,
            name: "Software Engineer",
            locations: ["New York", "Remote"],
            t_create: now,
            canonicalPositionUrl: "https://acme.eightfold.ai/careers/job/42",
          },
        ],
      })
    );

    const jobs = await eightfoldBoard.fetch(company, new Set(), AbortSignal.timeout(1000));

    expect(jobs).toEqual([
      {
        company: "Acme",
        role: "Software Engineer",
        link: "https://acme.eightfold.ai/careers/job/42?domain=jobs.acme.com&8fold_id=42",
        location: "New York, Remote",
      },
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("continues Eightfold pagination for a full PCSX page and stops on empty data", async () => {
    const company: Company = {
      name: "acme",
      ats: "eightfold",
      identifier: "acme",
      domain: "jobs.acme.com",
      page: "https://acme.eightfold.ai/api/pcsx/search?domain=jobs.acme.com",
      urls: [],
    };
    const now = Date.now();
    const positions = Array.from({ length: 10 }, (_, index) => ({
      id: index + 1,
      name: `Engineer ${index + 1}`,
      locations: ["Remote"],
      creationTs: now,
      postedTs: now,
      positionUrl: `/careers/job/${index + 1}`,
    }));

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: { positions } }))
      .mockResolvedValueOnce(jsonResponse({ data: { positions: [] } }));

    const jobs = await eightfoldBoard.fetch(company, new Set(), AbortSignal.timeout(1000));

    expect(jobs).toHaveLength(10);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(String(mockFetch.mock.calls[1][0])).toContain("start=10");
  });

  it("keeps Eightfold jobs from earlier pages when a later page returns an error", async () => {
    const company: Company = {
      name: "acme",
      ats: "eightfold",
      identifier: "acme",
      domain: "jobs.acme.com",
      page: "https://acme.eightfold.ai/api/pcsx/search?domain=jobs.acme.com",
      urls: [],
    };
    const now = Date.now();
    const positions = Array.from({ length: 10 }, (_, index) => ({
      id: index + 1,
      name: `Engineer ${index + 1}`,
      locations: ["Remote"],
      creationTs: now,
      postedTs: now,
      positionUrl: `/careers/job/${index + 1}`,
    }));

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: { positions } }))
      .mockResolvedValueOnce(new Response("", { status: 500, statusText: "Unavailable" }));

    const jobs = await eightfoldBoard.fetch(company, new Set(), AbortSignal.timeout(1000));

    expect(jobs).toHaveLength(10);
    expect(jobs[0]?.link).toContain("/careers/job/1");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(errorLog.append).toHaveBeenCalledWith("Eightfold: acme - 500 - Unavailable");
  });

  it("drops Eightfold jobs already fetched when a later page aborts", async () => {
    const company: Company = {
      name: "acme",
      ats: "eightfold",
      identifier: "acme",
      domain: "jobs.acme.com",
      page: "https://acme.eightfold.ai/api/pcsx/search?domain=jobs.acme.com",
      urls: [],
    };
    const now = Date.now();
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            positions: Array.from({ length: 10 }, (_, index) => ({
              id: index + 1,
              name: `Engineer ${index + 1}`,
              locations: ["Remote"],
              creationTs: now,
              postedTs: now,
              positionUrl: `/careers/job/${index + 1}`,
            })),
          },
        })
      )
      .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));

    await expect(eightfoldBoard.fetch(company, new Set(), AbortSignal.timeout(1000))).resolves.toEqual(
      []
    );
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      { company: "acme", url: company.page },
      "⚠️ Eightfold request aborted"
    );

    warn.mockRestore();
  });

  it("stops Eightfold after an old job and keeps a job with no posted time on that page", async () => {
    const company: Company = {
      name: "acme",
      ats: "eightfold",
      identifier: "acme",
      domain: "jobs.acme.com",
      page: "https://acme.eightfold.ai/api/pcsx/search?domain=jobs.acme.com",
      urls: [],
    };
    const now = Date.now();
    vi.mocked(withinDays).mockImplementation((date) => date === now);
    const positions = Array.from({ length: 10 }, (_, index) => ({
      id: index + 1,
      name: `Engineer ${index + 1}`,
      locations: ["Remote"],
      creationTs: now,
      postedTs: index === 4 ? 1 : index === 7 ? 0 : now,
      positionUrl: `/careers/job/${index + 1}`,
    }));

    mockFetch.mockResolvedValueOnce(jsonResponse({ data: { positions } }));

    const jobs = await eightfoldBoard.fetch(company, new Set(), AbortSignal.timeout(1000));

    expect(jobs.map((job) => job.role)).toEqual([
      "Engineer 1",
      "Engineer 2",
      "Engineer 3",
      "Engineer 4",
      "Engineer 6",
      "Engineer 7",
      "Engineer 8",
      "Engineer 9",
      "Engineer 10",
    ]);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("keeps Greenhouse target, known, and recent roles in response order", async () => {
    const company: Company = {
      name: "acme",
      ats: "greenhouse",
      identifier: "acme",
      domain: "https://acme.example",
      page: "https://boards-api.greenhouse.io/v1/boards/acme/jobs",
      urls: [],
    };
    const signal = AbortSignal.timeout(1000);
    vi.mocked(isTarget).mockImplementation((title) => title === "Software Engineer");
    vi.mocked(withinDays).mockImplementation((date) => date === "recent");

    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        jobs: [
          {
            title: "Recruiter",
            absolute_url: "https://boards.greenhouse.io/acme/jobs/1",
            updated_at: "recent",
          },
          {
            title: "Software Engineer",
            absolute_url: "https://boards.greenhouse.io/acme/jobs/2",
            updated_at: "old",
          },
          {
            title: "Software Engineer",
            absolute_url: "https://boards.greenhouse.io/acme/jobs/3",
            updated_at: "recent",
          },
          {
            title: "Software Engineer",
            absolute_url: "https://boards.greenhouse.io/acme/jobs/4",
            updated_at: "recent",
          },
        ],
      })
    );

    await expect(
      greenhouseBoard.fetch(
        company,
        toJobKeySet(["https://boards.greenhouse.io/acme/jobs/3"]),
        signal
      )
    ).resolves.toEqual([
      {
        company: "Acme",
        role: "Software Engineer",
        link: "https://boards.greenhouse.io/acme/jobs/4",
        location: "",
      },
    ]);
    expect(mockFetch).toHaveBeenCalledWith(company.page, { signal });
  });

  it.each([
    ["Greenhouse", greenhouseBoard],
    ["Lever", leverBoard],
    ["Smart Recruiters", smartRecruitersBoard],
    ["Oracle Cloud", oracleCloudBoard],
  ] as const)("returns no jobs when %s fails the listing request", async (label, fetcher) => {
    const company: Company = {
      name: "acme",
      ats: fetcher.ats,
      identifier: "acme",
      domain: "https://acme.example",
      page: `https://boards.example/${label}`,
      urls: [],
    };
    const signal = AbortSignal.timeout(1000);
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});

    mockFetch.mockResolvedValueOnce(new Response("", { status: 503, statusText: "Unavailable" }));
    await expect(fetcher.fetch(company, new Set(), signal)).resolves.toEqual([]);
    expect(errorLog.append).toHaveBeenCalledWith(`${label}: acme - 503 - Unavailable`);
    expect(mockFetch).toHaveBeenCalledWith(company.page, { signal });

    const aborted = new DOMException("timed out", "TimeoutError");
    mockFetch.mockRejectedValueOnce(aborted);
    await expect(fetcher.fetch(company, new Set(), signal)).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      { company: "acme", url: company.page },
      `⚠️ ${label} request aborted`
    );

    const abortedByCaller = new DOMException("stopped", "AbortError");
    mockFetch.mockRejectedValueOnce(abortedByCaller);
    await expect(fetcher.fetch(company, new Set(), signal)).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      { company: "acme", url: company.page },
      `⚠️ ${label} request aborted`
    );

    const unreachable = new TypeError("fetch failed", {
      cause: new Error("connect ECONNREFUSED"),
    });
    mockFetch.mockRejectedValueOnce(unreachable);
    await expect(fetcher.fetch(company, new Set(), signal)).resolves.toEqual([]);
    expect(errorLog.append).toHaveBeenCalledWith(`${label}: acme - connect ECONNREFUSED`);

    const crash = new Error("boom");
    mockFetch.mockRejectedValueOnce(crash);
    await expect(fetcher.fetch(company, new Set(), signal)).resolves.toEqual([]);
    expect(error).toHaveBeenCalledWith(
      { error: crash, company: "acme", url: company.page },
      `${RED_CROSS} Error fetching ${label.toLowerCase()} jobs`
    );
    expect(warn).toHaveBeenCalledTimes(2);

    warn.mockRestore();
    error.mockRestore();
  });

  it("returns Greenhouse jobs from getJobs with known links already removed", async () => {
    const known = "https://boards.greenhouse.io/acme/jobs/1";
    const company: Company = {
      name: "acme",
      ats: "greenhouse",
      identifier: "acme",
      domain: "https://boards.greenhouse.io",
      page: "https://boards-api.greenhouse.io/v1/boards/acme/jobs",
      urls: [known],
    };
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        jobs: [
          {
            title: "Platform Engineer",
            absolute_url: "https://boards.greenhouse.io/acme/jobs/2",
            updated_at: "recent",
          },
          { title: "Software Engineer", absolute_url: known, updated_at: "recent" },
          {
            title: "Quant Engineer",
            absolute_url: "https://boards.greenhouse.io/acme/jobs/3",
            updated_at: "recent",
          },
        ],
      })
    );

    const jobs = await new GreenhouseBoard(company).getJobs();

    expect(jobs.map((job) => job.link)).toEqual([
      "https://boards.greenhouse.io/acme/jobs/2",
      "https://boards.greenhouse.io/acme/jobs/3",
    ]);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("drops known Lever jobs and keeps the rest in order", async () => {
    const company: Company = {
      name: "acme",
      ats: "lever",
      identifier: "acme",
      domain: "https://jobs.lever.co",
      page: "https://api.lever.co/v0/postings/acme?mode=json",
      urls: [],
    };
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          text: "Platform Engineer",
          hostedUrl: "https://jobs.lever.co/acme/aaa",
          createdAt: 1,
          categories: { location: "Remote" },
        },
        {
          text: "Known Engineer",
          hostedUrl: "https://jobs.lever.co/acme/bbb",
          createdAt: 1,
          categories: { location: "NYC" },
        },
        {
          text: "Quant Engineer",
          hostedUrl: "https://jobs.lever.co/acme/ccc",
          createdAt: 1,
          categories: { location: "SF" },
        },
      ])
    );

    const jobs = await leverBoard.fetch(
      company,
      toJobKeySet(["https://jobs.lever.co/acme/bbb?utm=1"]),
      AbortSignal.timeout(1000)
    );

    expect(jobs.map((job) => job.link)).toEqual([
      "https://jobs.lever.co/acme/aaa",
      "https://jobs.lever.co/acme/ccc",
    ]);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("drops known SmartRecruiters jobs by the id in the built link", async () => {
    const company: Company = {
      name: "acme",
      ats: "smartrecruiters",
      identifier: "acme",
      domain: "https://jobs.smartrecruiters.com",
      page: "https://api.smartrecruiters.com/v1/companies/acme/postings",
      urls: [],
    };
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        content: [
          { id: "111", name: "Platform Engineer", releasedDate: "recent", company: { name: "Acme" } },
          { id: "222", name: "Known Engineer", releasedDate: "recent", company: { name: "Acme" } },
          { id: "333", name: "Quant Engineer", releasedDate: "recent", company: { name: "Acme" } },
        ],
      })
    );

    const jobs = await smartRecruitersBoard.fetch(
      company,
      toJobKeySet(["https://jobs.smartrecruiters.com/other/222?src=1"]),
      AbortSignal.timeout(1000)
    );

    expect(jobs.map((job) => job.link)).toEqual([
      "https://jobs.smartrecruiters.com/acme/111",
      "https://jobs.smartrecruiters.com/acme/333",
    ]);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("drops known Oracle Cloud jobs after the requisition link is composed", async () => {
    const domain = "https://ecge.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job";
    const company: Company = {
      name: "acme",
      ats: "oraclecloud",
      identifier: "ecge.fa.us2.oraclecloud.com",
      domain,
      page: "https://ecge.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions",
      urls: [],
    };
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            requisitionList: [
              { Id: "111", Title: "Platform Engineer", PostedDate: "recent", PrimaryLocation: "Remote" },
              { Id: "222", Title: "Known Engineer", PostedDate: "recent", PrimaryLocation: "NYC" },
              { Id: "333", Title: "Quant Engineer", PostedDate: "recent", PrimaryLocation: "SF" },
            ],
          },
        ],
      })
    );

    const jobs = await oracleCloudBoard.fetch(
      company,
      toJobKeySet([`${domain}/222?src=1`]),
      AbortSignal.timeout(1000)
    );

    expect(jobs.map((job) => job.link)).toEqual([`${domain}/111`, `${domain}/333`]);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("drops a known Eightfold job after the tracking parameter is added", async () => {
    const company: Company = {
      name: "acme",
      ats: "eightfold",
      identifier: "acme",
      domain: "jobs.acme.com",
      page: "https://acme.eightfold.ai/api/pcsx/search?domain=jobs.acme.com",
      urls: [],
    };
    const now = Date.now();
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        data: {
          positions: [
            {
              id: 1,
              name: "Platform Engineer",
              locations: ["Remote"],
              creationTs: now,
              postedTs: now,
              positionUrl: "/careers/job/1",
            },
            {
              id: 2,
              name: "Known Engineer",
              locations: ["NYC"],
              creationTs: now,
              postedTs: now,
              positionUrl: "/careers/job/2",
            },
            {
              id: 3,
              name: "Quant Engineer",
              locations: ["SF"],
              creationTs: now,
              postedTs: now,
              positionUrl: "/careers/job/3",
            },
          ],
        },
      })
    );

    const jobs = await eightfoldBoard.fetch(
      company,
      toJobKeySet(["https://acme.eightfold.ai/careers/job/2?pid=2"]),
      AbortSignal.timeout(1000)
    );

    expect(jobs.map((job) => job.link)).toEqual([
      "https://acme.eightfold.ai/careers/job/1?domain=jobs.acme.com&8fold_id=1",
      "https://acme.eightfold.ai/careers/job/3?domain=jobs.acme.com&8fold_id=3",
    ]);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("returns nothing from an unsupported board", async () => {
    const company: Company = {
      name: "example.com",
      ats: "none",
      identifier: "example.com",
      domain: "https://example.com",
      page: "",
      urls: ["https://example.com/jobs/1"],
    };

    await expect(new NoneBoard(company).getJobs()).resolves.toEqual([]);
    expect(noneBoard.ats).toBe("none");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
