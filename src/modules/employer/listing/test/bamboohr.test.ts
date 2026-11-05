import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Titles from "@/modules/posting/screening";

vi.mock("@/modules/posting/screening", async (importOriginal) => {
  const actual = await importOriginal<typeof Titles>();
  return {
    ...actual,
    isTarget: vi.fn((title: string) => /engineer/i.test(title)),
    withinDays: vi.fn((date: unknown) => date === "2026-11-02"),
  };
});

vi.mock("@/store", () => ({ errorLog: { append: vi.fn() } }));

import type { Company } from "@/types";

import { Board } from "../../employer";
import { bambooHRBoard } from "../bamboohr";

import { toJobKeySet } from "@/modules/ats/job-key";
import { errorLog } from "@/store";

const mockFetch = vi.fn<typeof fetch>();

const company: Company = {
  name: "Mujin",
  ats: "bamboohr",
  identifier: "mujin",
  domain: "https://mujin.bamboohr.com",
  page: "https://mujin.bamboohr.com/careers/list",
  urls: [],
};

function detail(datePosted: string): Response {
  return Response.json({ result: { jobOpening: { datePosted } } });
}

function row(id: string, jobOpeningName: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    jobOpeningName,
    location: { city: "Atlanta", state: "Georgia" },
    atsLocation: { country: "United States", state: "Georgia", province: null, city: "Atlanta" },
    isRemote: null,
    ...extra,
  };
}

describe("BambooHR fetcher", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.mocked(errorLog.append).mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("is a stateless singleton on the common contract", () => {
    expect(bambooHRBoard).toBeInstanceOf(Board);
    expect(Object.keys(bambooHRBoard)).toEqual(["ats"]);
  });

  it("keys companies by tenant and names them from og:site_name", async () => {
    const url = new URL("https://mujin.bamboohr.com/careers/126");
    mockFetch.mockResolvedValueOnce(
      new Response('<meta property="og:site_name" content="Mujin" />')
    );

    expect(bambooHRBoard.companyKeyFromUrl(url)).toBe("bamboohr:mujin");
    await expect(bambooHRBoard.formCompany(url)).resolves.toEqual(company);
    expect(String(mockFetch.mock.calls[0][0])).toBe("https://mujin.bamboohr.com/careers");
  });

  it("dates only unknown target jobs and keeps the recent ones", async () => {
    const knownKeys = toJobKeySet(["https://mujin.bamboohr.com/careers/3"]);

    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url === company.page) {
        return Response.json({
          meta: { totalCount: 5 },
          result: [
            row("1", "Robotics Software Engineer"),
            row("2", "Software Engineer II", { location: null, atsLocation: null, isRemote: true }),
            row("3", "Software Engineer (Known)"),
            row("4", "Office Manager"),
            row("5", "Controls Engineer"),
          ],
        });
      }
      if (url.endsWith("/careers/1/detail")) return detail("2026-11-02");
      if (url.endsWith("/careers/2/detail")) return detail("2026-11-02");
      if (url.endsWith("/careers/5/detail")) return detail("2026-08-01");
      throw new Error(`unexpected fetch ${url}`);
    });

    const jobs = await bambooHRBoard.fetch(company, knownKeys, AbortSignal.timeout(1000));

    expect(jobs).toEqual([
      {
        company: "Mujin",
        role: "Robotics Software Engineer",
        link: "https://mujin.bamboohr.com/careers/1",
        location: "Atlanta, Georgia",
      },
      {
        company: "Mujin",
        role: "Software Engineer II",
        link: "https://mujin.bamboohr.com/careers/2",
        location: "Remote",
      },
    ]);
    expect(mockFetch.mock.calls.map(([input]) => String(input)).sort()).toEqual(
      [
        company.page,
        "https://mujin.bamboohr.com/careers/1/detail",
        "https://mujin.bamboohr.com/careers/2/detail",
        "https://mujin.bamboohr.com/careers/5/detail",
      ].sort()
    );
  });

  it("lists every posting key for liveness checks", async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ result: [row("126", "Office Manager")] }));

    await expect(bambooHRBoard.listJobKeys(company, AbortSignal.timeout(1000))).resolves.toEqual(
      new Set(["bamboohr:mujin:126"])
    );
  });

  it("logs and returns nothing when the tenant redirects to the marketing site", async () => {
    const res = new Response("<html></html>");
    Object.defineProperty(res, "url", { value: "https://www.bamboohr.com/" });
    mockFetch.mockResolvedValueOnce(res);

    await expect(
      bambooHRBoard.fetch(company, new Set(), AbortSignal.timeout(1000))
    ).resolves.toEqual([]);
    expect(errorLog.append).toHaveBeenCalledWith("BambooHR: Mujin - board no longer exists");
  });

  it("logs an HTTP failure and returns nothing", async () => {
    mockFetch.mockResolvedValueOnce(new Response("", { status: 500, statusText: "Server Error" }));

    await expect(
      bambooHRBoard.fetch(company, new Set(), AbortSignal.timeout(1000))
    ).resolves.toEqual([]);
    expect(errorLog.append).toHaveBeenCalledWith("BambooHR: Mujin - 500 - Server Error");
  });

  it("keeps dated jobs when another posting date is missing", async () => {
    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url === company.page) {
        return Response.json({
          result: [row("1", "Robotics Software Engineer"), row("2", "Software Engineer II")],
        });
      }
      if (url.endsWith("/careers/1/detail")) return detail("2026-11-02");
      if (url.endsWith("/careers/2/detail")) return new Response("", { status: 404 });
      throw new Error(`unexpected fetch ${url}`);
    });

    await expect(
      bambooHRBoard.fetch(company, new Set(), AbortSignal.timeout(1000))
    ).resolves.toEqual([
      {
        company: "Mujin",
        role: "Robotics Software Engineer",
        link: "https://mujin.bamboohr.com/careers/1",
        location: "Atlanta, Georgia",
      },
    ]);
    expect(errorLog.append).toHaveBeenCalledWith("BambooHR: Mujin - no posting date for 1/2 jobs");
  });
});
