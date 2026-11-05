import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Screening from "@/modules/posting/screening";
import type * as Store from "@/store";
import type { Company } from "@/types";

vi.mock("@/modules/posting/screening", async (importOriginal) => {
  const actual = await importOriginal<typeof Screening>();
  return { ...actual, isTarget: vi.fn(() => true) };
});

vi.mock("@/store", async (importOriginal) => {
  const actual = await importOriginal<typeof Store>();
  return { ...actual, errorLog: { ...actual.errorLog, append: vi.fn() } };
});

import { eightfoldBoard } from "../eightfold";
import { phenomBoard } from "../phenom";
import { workdayBoard } from "../workday";

import { getJobKey } from "@/modules/ats/job-key";
import { listingTargetsFound } from "@/modules/employer/listing-scan";

const mockFetch = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, url: string): Response {
  const response = new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function htmlResponse(body: string, url: string): Response {
  const response = new Response(body, { status: 200, headers: { "content-type": "text/html" } });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

const workdayCompany: Company = {
  name: "acme",
  ats: "workday",
  identifier: "acme-external",
  domain: "https://acme.wd1.myworkdayjobs.com/en-US/external",
  page: "https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/external/jobs",
  urls: [],
};

function workdayPage(ids: string[]) {
  return {
    jobPostings: ids.map((id) => ({
      title: `Role ${id}`,
      postedOn: "Posted Yesterday",
      locationsText: "Remote",
      externalPath: `/job/Role_${id}`,
    })),
  };
}

const eightfoldCompany: Company = {
  name: "acme",
  ats: "eightfold",
  identifier: "acme",
  domain: "jobs.acme.com",
  page: "https://acme.eightfold.ai/api/apply/v2/jobs?domain=jobs.acme.com",
  urls: [],
};

function eightfoldLink(id: number): string {
  const url = new URL(eightfoldCompany.page);
  url.pathname = `/careers/job/${id}`;
  url.searchParams.set("8fold_id", String(id));
  return url.toString();
}

function eightfoldPage(ids: number[]) {
  return {
    positions: ids.map((id) => ({
      id,
      name: "Software Engineer",
      locations: ["Remote"],
      t_create: Date.now(),
      canonicalPositionUrl: `https://acme.eightfold.ai/careers/job/${id}`,
    })),
  };
}

const phenomCompany: Company = {
  name: "acme",
  ats: "phenom",
  identifier: "careers.acme.com",
  domain: "https://careers.acme.com",
  page: "https://careers.acme.com",
  urls: [],
};

function phenomLink(id: string): string {
  return `https://careers.acme.com/job/${id}?ph_id=${id}`;
}

describe("liveness listing scan", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("does not treat an empty target set as every target already found", () => {
    expect(listingTargetsFound(new Set(["workday:acme:R1000"]), undefined)).toBe(false);
    expect(listingTargetsFound(new Set(["workday:acme:R1000"]), { targetKeys: new Set() })).toBe(
      false
    );
    expect(
      listingTargetsFound(new Set(["workday:acme:R1000"]), {
        targetKeys: new Set(["workday:acme:R1000"]),
      })
    ).toBe(true);
  });

  it("keeps requesting Workday pages when no target set is provided", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(workdayPage(fullIds("R1", 20)), workdayCompany.page))
      .mockResolvedValueOnce(jsonResponse(workdayPage(["R21"]), workdayCompany.page));

    const keys = await workdayBoard.listJobKeys(workdayCompany, AbortSignal.timeout(1000));

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(keys?.has("workday:acme:R1")).toBe(true);
    expect(keys?.has("workday:acme:R21")).toBe(true);
  });

  it("does not request the next Workday page once every target key is found", async () => {
    mockFetch.mockImplementation(() => {
      if (mockFetch.mock.calls.length > 1) throw new Error("next page");
      return Promise.resolve(jsonResponse(workdayPage(fullIds("R1000", 20)), workdayCompany.page));
    });

    const keys = await workdayBoard.listJobKeys(workdayCompany, AbortSignal.timeout(1000), {
      targetKeys: new Set(["workday:acme:R1000"]),
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(keys?.has("workday:acme:R1000")).toBe(true);
  });

  it("requests another Workday page when only some target keys have been found", async () => {
    const first = fullIds("R1000", 20);
    const second = fullIds("R2000", 20);
    mockFetch
      .mockResolvedValueOnce(jsonResponse(workdayPage(first), workdayCompany.page))
      .mockResolvedValueOnce(jsonResponse(workdayPage(second), workdayCompany.page))
      .mockImplementation(() => {
        throw new Error("page 3");
      });

    const keys = await workdayBoard.listJobKeys(workdayCompany, AbortSignal.timeout(1000), {
      targetKeys: new Set(["workday:acme:R1000", "workday:acme:R2000"]),
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(keys?.has("workday:acme:R1000")).toBe(true);
    expect(keys?.has("workday:acme:R2000")).toBe(true);
  });

  it("still walks Workday discovery pages when the first page is full", async () => {
    const today = Array.from({ length: 20 }, (_, index) => ({
      title: `Software Engineer ${index}`,
      postedOn: "Posted Today",
      locationsText: "Remote",
      externalPath: `/job/${index}`,
    }));
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ jobPostings: today }, workdayCompany.page))
      .mockResolvedValueOnce(jsonResponse({ jobPostings: [] }, workdayCompany.page));

    await workdayBoard.fetch(workdayCompany, new Set(["workday:acme:0"]), AbortSignal.timeout(1000));

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("stops Eightfold liveness on a full page only after every target key is found", async () => {
    const target = getJobKey(eightfoldLink(1));
    mockFetch.mockImplementation(() => {
      if (mockFetch.mock.calls.length > 1) throw new Error("next page");
      return Promise.resolve(jsonResponse(eightfoldPage(Array.from({ length: 10 }, (_, index) => index + 1)), eightfoldCompany.page));
    });

    const keys = await eightfoldBoard.listJobKeys(eightfoldCompany, AbortSignal.timeout(1000), {
      targetKeys: new Set([target]),
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(keys?.has(target)).toBe(true);
  });

  it("keeps paging Eightfold when a target is still missing", async () => {
    const first = getJobKey(eightfoldLink(1));
    const second = getJobKey(eightfoldLink(11));
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse(eightfoldPage(Array.from({ length: 10 }, (_, index) => index + 1)), eightfoldCompany.page)
      )
      .mockResolvedValueOnce(
        jsonResponse(eightfoldPage(Array.from({ length: 10 }, (_, index) => index + 11)), eightfoldCompany.page)
      )
      .mockImplementation(() => {
        throw new Error("page 3");
      });

    const keys = await eightfoldBoard.listJobKeys(eightfoldCompany, AbortSignal.timeout(1000), {
      targetKeys: new Set([first, second]),
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(keys?.has(first)).toBe(true);
    expect(keys?.has(second)).toBe(true);
  });

  it("still requests the next Eightfold discovery page when a known key is on the first page", async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse(eightfoldPage(Array.from({ length: 10 }, (_, index) => index + 1)), eightfoldCompany.page)
      )
      .mockResolvedValueOnce(jsonResponse(eightfoldPage([11]), eightfoldCompany.page));

    await eightfoldBoard.fetch(
      eightfoldCompany,
      new Set([getJobKey(eightfoldLink(1))]),
      AbortSignal.timeout(1000)
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("stops Phenom liveness when the first page already contains every target", async () => {
    const froms: number[] = [];
    mockWidgets(froms, [fullIds("R0", 100), ["R100"]]);

    const keys = await phenomBoard.listJobKeys(phenomCompany, AbortSignal.timeout(1000), {
      targetKeys: new Set([getJobKey(phenomLink("R0"))]),
    });

    expect(froms).toEqual([0]);
    expect(keys?.has(getJobKey(phenomLink("R0")))).toBe(true);
  });

  it("requests the next Phenom page when a target key is still missing", async () => {
    const froms: number[] = [];
    mockWidgets(froms, [fullIds("R0", 100), fullIds("R100", 100), ["R200"]]);

    await phenomBoard.listJobKeys(phenomCompany, AbortSignal.timeout(1000), {
      targetKeys: new Set([getJobKey(phenomLink("R0")), getJobKey(phenomLink("R100"))]),
    });

    expect(froms).toEqual([0, 100]);
  });

  it("still lists every Phenom page when no target set is provided", async () => {
    const froms: number[] = [];
    mockWidgets(froms, [fullIds("R0", 100), ["R100"]]);

    const keys = await phenomBoard.listJobKeys(phenomCompany, AbortSignal.timeout(1000));

    expect(froms).toEqual([0, 100]);
    expect(keys?.size).toBe(101);
  });

  it("still requests the next Phenom discovery page when the known key was on page one", async () => {
    const froms: number[] = [];
    const recent = new Date().toISOString();
    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      if (!url.endsWith("/widgets")) {
        return htmlResponse(`<script>{"csrfToken":"token"}</script>`, "https://careers.acme.com/us/en/");
      }
      const { from } = JSON.parse(String(init?.body)) as { from: number };
      froms.push(from);
      const ids = from === 0 ? fullIds("R0", 100) : ["R100"];
      return jsonResponse(
        {
          refineSearch: {
            data: {
              jobs: ids.map((jobId) => ({ jobId, title: "Engineer", postedDate: recent })),
            },
          },
        },
        url
      );
    });

    await phenomBoard.fetch(
      phenomCompany,
      new Set([getJobKey(phenomLink("R0"))]),
      AbortSignal.timeout(1000)
    );

    expect(froms).toEqual([0, 100]);
  });
});

function fullIds(first: string, count: number): string[] {
  const prefix = first.replace(/\d+$/, "");
  const start = Number(first.slice(prefix.length));
  return Array.from({ length: count }, (_, index) => `${prefix}${start + index}`);
}

function mockWidgets(froms: number[], pages: string[][]) {
  mockFetch.mockImplementation(async (input, init) => {
    const url = String(input);
    if (!url.endsWith("/widgets")) {
      return htmlResponse(`<script>{"csrfToken":"token"}</script>`, "https://careers.acme.com/us/en/");
    }
    const { from } = JSON.parse(String(init?.body)) as { from: number };
    froms.push(from);
    const ids = pages[from / 100] ?? [];
    if (froms.length > pages.length) throw new Error("extra page");
    return jsonResponse(
      {
        refineSearch: {
          data: {
            jobs: ids.map((jobId) => ({
              jobId,
              title: "Accountant",
              postedDate: "2020-01-01T00:00:00Z",
            })),
          },
        },
      },
      url
    );
  });
}
