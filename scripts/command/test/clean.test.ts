import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as BuildModule from "@/modules/employer/build";
import type { JDFetchResult } from "@/modules/posting/jd";
import type * as Store from "@/store";
import type { Company } from "@/types";

const mocks = vi.hoisted(() => ({
  urlsLoad: vi.fn(async () => new Set<string>()),
  urlsSave: vi.fn(async () => undefined),
  opportunitiesLoad: vi.fn(async () => []),
  opportunitiesReplace: vi.fn(async () => undefined),
  companiesLoad: vi.fn(async () => [] as Company[]),
  deduplicate: vi.fn(async () => undefined),
  errorLogAppend: vi.fn(async () => undefined),
  buildCompanyList: vi.fn(async () => undefined),
}));

vi.mock("@/store", async (importOriginal) => {
  const actual = await importOriginal<typeof Store>();
  return {
    ...actual,
    urls: { load: mocks.urlsLoad, save: mocks.urlsSave },
    opportunities: {
      ...actual.opportunities,
      load: mocks.opportunitiesLoad,
      replace: mocks.opportunitiesReplace,
    },
    companies: { ...actual.companies, load: mocks.companiesLoad },
    errorLog: { ...actual.errorLog, append: mocks.errorLogAppend },
  };
});

vi.mock("../job/dedup", () => ({ default: mocks.deduplicate }));

vi.mock("@/modules/employer/build", async (importOriginal) => {
  const actual = await importOriginal<typeof BuildModule>();
  return { ...actual, buildCompanyList: mocks.buildCompanyList };
});

import type { CleanProgress } from "../job/clean";

import { classifyJdFetch, cleanUrls, formatCleanStatus, runClean, unknownReason } from "../job/clean";

import { companyKey } from "@/modules/employer/build";
import { companyKeyFromUrl } from "@/modules/employer/keys";
import { AppleCompany } from "@/modules/employer/listing/custom/apple";
import { leverBoard } from "@/modules/employer/listing/lever";
import { workdayBoard } from "@/modules/employer/listing/workday";
import { HttpStatusCode, JD_FETCH_ERROR, JD_FETCH_OK } from "@/modules/posting/jd";
import { logger } from "@/utils/logger";

const ok = (jd = "Engineer"): JDFetchResult => ({ jd, error: JD_FETCH_OK });
const status = (code: number, desc: string): JDFetchResult => ({
  jd: null,
  error: { code, desc },
});

function cleanMeasuredText(calls: readonly unknown[][]): string | undefined {
  for (const call of calls) {
    const text = call[0];
    if (typeof text === "string" && text.includes("Clean measured")) return text;
  }
  return undefined;
}

function cleanMeasured(calls: readonly unknown[][]): Record<string, unknown> | undefined {
  const text = cleanMeasuredText(calls);
  if (!text) return undefined;
  return JSON.parse(text.slice(text.indexOf("{"))) as Record<string, unknown>;
}

const JOB_HTML = `<!doctype html><html><body><script type="application/ld+json">{"@type":"JobPosting","title":"Engineer","description":"Build the platform and own the service."}</script></body></html>`;

function http(code: number, body: string, url: string, type = "text/html"): Response {
  const statusText: Record<number, string> = {
    200: "OK",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    410: "Gone",
    422: "Unprocessable Entity",
    429: "Too Many Requests",
    500: "Internal Server Error",
    503: "Service Unavailable",
  };
  const response = new Response(body, {
    status: code,
    statusText: statusText[code] ?? "Error",
    headers: { "content-type": type },
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function lever(board: string, id: string) {
  const url = `https://jobs.lever.co/${board}/${id}`;
  return { url, company: leverBoard.formCompany(new URL(url)) };
}

describe("classifyJdFetch", () => {
  it.each([
    [401, "Unauthorized"],
    [403, "Forbidden"],
    [408, "Request Timeout"],
    [422, "Unprocessable Entity"],
    [429, "Too Many Requests"],
    [500, "Internal Server Error"],
    [503, "Service Unavailable"],
    [0, "The operation was aborted due to timeout"],
    [400, "Invalid Workday URL"],
  ])("keeps HTTP %s", (code, desc) => {
    expect(classifyJdFetch({ code, desc })).toBe("unknown");
  });

  it("keeps a synthetic 404 and removes only an endpoint 404 or 410", () => {
    expect(HttpStatusCode.isError(401)).toBe(true);
    expect(HttpStatusCode.isError(500)).toBe(true);
    expect(classifyJdFetch(JD_FETCH_ERROR.noData())).toBe("unknown");
    expect(classifyJdFetch(JD_FETCH_ERROR.internal())).toBe("unknown");
    expect(classifyJdFetch({ code: 404, desc: "Not Found" })).toBe("gone");
    expect(classifyJdFetch({ code: 410, desc: "Gone" })).toBe("gone");
    expect(classifyJdFetch(JD_FETCH_OK)).toBe("live");
  });

  it("does not print an ETA from mixed listing and JD progress", () => {
    const line = formatCleanStatus({
      completed: 1,
      total: 4,
      companiesDone: 1,
      companiesTotal: 2,
      jdPending: 2,
      jdActive: 1,
      retries: 1,
      unknown: 1,
      elapsedMs: 4_000,
    });

    expect(line).toContain("clean 1/4");
    expect(line).toContain("companies 1/2");
    expect(line).toContain("jd waiting 2");
    expect(line).toContain("active 1");
    expect(line).toContain("retries 1");
    expect(line).toContain("unknown 1");
    expect(line).not.toMatch(/eta/i);
  });
});

describe("runClean", () => {
  const previousLevel = logger.level;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logger.level = "silent";
    mocks.urlsLoad.mockReset().mockResolvedValue(new Set());
    mocks.urlsSave.mockReset().mockResolvedValue(undefined);
    mocks.opportunitiesLoad.mockReset().mockResolvedValue([]);
    mocks.opportunitiesReplace.mockReset().mockResolvedValue(undefined);
    mocks.companiesLoad.mockReset().mockResolvedValue([]);
    mocks.deduplicate.mockReset().mockResolvedValue(undefined);
    mocks.errorLogAppend.mockReset().mockResolvedValue(undefined);
    mocks.buildCompanyList.mockReset().mockResolvedValue(undefined);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", () => {
      throw new Error("unexpected network");
    });
  });

  afterEach(() => {
    logger.level = previousLevel;
    logSpy.mockRestore();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps blocked, rate-limited, server, timeout, and synthetic results", async () => {
    const cases: Array<[string, JDFetchResult, "keep" | "drop"]> = [
      ["https://jobs.lever.co/acme/401", status(401, "Unauthorized"), "keep"],
      ["https://jobs.lever.co/acme/403", status(403, "Forbidden"), "keep"],
      ["https://jobs.lever.co/acme/429", status(429, "Too Many Requests"), "keep"],
      ["https://jobs.lever.co/acme/500", status(500, "Internal Server Error"), "keep"],
      ["https://jobs.lever.co/acme/503", status(503, "Service Unavailable"), "keep"],
      ["https://jobs.lever.co/acme/timeout", status(0, "timed out"), "keep"],
      ["https://jobs.lever.co/acme/synthetic", { jd: null, error: JD_FETCH_ERROR.noData() }, "keep"],
      [
        "https://jobs.lever.co/acme/invalid",
        { jd: null, error: JD_FETCH_ERROR.invalidUrl("Invalid URL") },
        "keep",
      ],
      ["https://jobs.lever.co/acme/compat", status(422, "Unprocessable Entity"), "keep"],
      ["https://jobs.lever.co/acme/live", ok(), "keep"],
      ["https://jobs.lever.co/acme/gone", status(404, "Not Found"), "drop"],
      ["https://jobs.lever.co/acme/removed", status(410, "Gone"), "drop"],
    ];

    const report = await runClean({
      urls: cases.map(([url]) => url),
      companies: [],
      hooks: {
        fetchJd: async (url) => cases.find(([candidate]) => candidate === url)?.[1] ?? ok(),
        sleep: async () => undefined,
        random: () => 0,
      },
    });

    expect([...report.dropped].sort()).toEqual([
      "https://jobs.lever.co/acme/gone",
      "https://jobs.lever.co/acme/removed",
    ]);
    expect(report.urls).toHaveLength(cases.length - 2);
    expect(report.unknown).toBe(9);
    expect(mocks.urlsSave).not.toHaveBeenCalled();
    expect(mocks.opportunitiesReplace).not.toHaveBeenCalled();
    expect(mocks.deduplicate).not.toHaveBeenCalled();
    expect(mocks.buildCompanyList).not.toHaveBeenCalled();
  });

  it("keeps a recovered HTML fallback and a real API body, and drops a final 404", async () => {
    const gh = (id: string) => `https://boards.greenhouse.io/acme/jobs/${id}`;
    const live = gh("201");
    const fallback = gh("202");
    const gone = gh("203");
    const unauthorized = gh("401");
    const forbidden = gh("403");
    const rateLimited = gh("429");
    const server = gh("500");
    const unavailable = gh("503");
    const timedOut = gh("209");
    const synthetic = gh("210");
    const redirected = gh("211");
    const workday = "https://acme.wd1.myworkdayjobs.com/en-US/external/job/Engineer_R1000";
    const calls: string[] = [];

    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/jobs/209")) {
        throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
      }
      if (url.includes("/wday/cxs/")) return http(422, "", url, "application/json");
      if (url.includes("myworkdayjobs.com")) return http(200, JOB_HTML, url);

      const id = url.match(/\/jobs\/(\d+)/)?.[1];
      const api = url.includes("boards-api.greenhouse.io");
      if (id === "201") return http(200, JSON.stringify({ content: "Engineer" }), url, "application/json");
      if (id === "202" && api) return http(404, "", url);
      if (id === "202") return http(200, JOB_HTML, url);
      if (id === "203") return http(404, "", url);
      if (id === "401") return http(401, "", url);
      if (id === "403") return http(403, "", url);
      if (id === "429") return http(429, "", url);
      if (id === "500") return http(500, "", url);
      if (id === "503") return http(503, "", url);
      if (id === "210" && api) return http(200, "null", url, "application/json");
      if (id === "210") return http(200, "<html><body>This job is no longer available</body></html>", url);
      if (id === "211" && api) return http(404, "", url);
      if (id === "211") return http(200, "<html><body>Careers home</body></html>", "https://boards.greenhouse.io/acme");
      throw new Error(`unexpected ${url}`);
    });

    const report = await runClean({
      urls: [live, fallback, gone, unauthorized, forbidden, rateLimited, server, unavailable, timedOut, synthetic, redirected, workday],
      companies: [],
      hooks: { sleep: async () => undefined, random: () => 0, now: () => 0 },
    });

    const count = (part: string) => calls.filter((url) => url.includes(part)).length;
    expect(report.dropped).toEqual([gone]);
    expect(report.urls).toEqual([
      live,
      fallback,
      unauthorized,
      forbidden,
      rateLimited,
      server,
      unavailable,
      timedOut,
      synthetic,
      redirected,
      workday,
    ]);
    expect(count("/jobs/201")).toBe(1);
    expect(count("/jobs/202")).toBe(2);
    expect(count("/jobs/401")).toBe(2);
    expect(count("/jobs/403")).toBe(2);
    expect(count("/jobs/429")).toBe(7);
    expect(count("/jobs/209")).toBe(7);
    expect(count("/jobs/500")).toBe(2);
    expect(count("/jobs/503")).toBe(2);
    expect(count("/wday/cxs/")).toBe(1);
    expect(calls.filter((url) => url.includes("myworkdayjobs.com") && !url.includes("/wday/cxs/"))).toHaveLength(1);
    expect(calls.some((url) => url.includes("/jobs/429") && url.includes("boards.greenhouse.io"))).toBe(false);
  });

  it("does not drop the batch when one listing or one JD fails", async () => {
    const alpha = lever("alpha", "11111111-1111-4111-8111-111111111111");
    const beta = lever("beta", "22222222-2222-4222-8222-222222222222");
    const gamma = lever("gamma", "33333333-3333-4333-8333-333333333333");
    const seen: string[] = [];

    const report = await runClean({
      urls: [alpha.url, beta.url, gamma.url],
      companies: [alpha.company, beta.company, gamma.company],
      hooks: {
        checkListing: async (company) => {
          if (company.identifier === "alpha") throw new Error("listing failed");
          if (company.identifier === "beta") return { listed: [beta.url], unverified: [] };
          return { listed: [], unverified: [gamma.url] };
        },
        fetchJd: async (url) => {
          seen.push(url);
          if (url === alpha.url) throw new Error("jd failed");
          return status(503, "Service Unavailable");
        },
        sleep: async () => undefined,
      },
    });

    expect([...seen].sort()).toEqual([alpha.url, gamma.url]);
    expect(report.dropped).toEqual([]);
    expect(report.urls).toEqual([alpha.url, beta.url, gamma.url]);
    expect(report.listingHits).toBe(1);
    expect(report.unknown).toBe(2);
  });

  it("starts JD for a finished company while another listing is still running", async () => {
    const alpha = lever("alpha", "11111111-1111-4111-8111-111111111111");
    const beta = lever("beta", "22222222-2222-4222-8222-222222222222");
    let slowListing = false;
    let releaseListing = () => {};
    let releaseJd = () => {};
    const listingGate = new Promise<void>((resolve) => {
      releaseListing = resolve;
    });
    const jdGate = new Promise<void>((resolve) => {
      releaseJd = resolve;
    });
    let jdStarted = () => {};
    const started = new Promise<void>((resolve) => {
      jdStarted = resolve;
    });
    const snapshots: CleanProgress[] = [];
    let companiesWhenJdStarted = -1;

    try {
      const pending = runClean({
        urls: [alpha.url, beta.url],
        companies: [alpha.company, beta.company],
        hooks: {
          onProgress: (progress) => snapshots.push({ ...progress }),
          checkListing: async (company) => {
            if (company.identifier === "beta") {
              slowListing = true;
              await listingGate;
              slowListing = false;
            }
            return { listed: [], unverified: [company.identifier === "beta" ? beta.url : alpha.url] };
          },
          fetchJd: async (url) => {
            if (url === alpha.url) {
              companiesWhenJdStarted = snapshots.at(-1)?.companiesDone ?? -1;
              jdStarted();
              await jdGate;
            }
            return ok();
          },
          sleep: async () => undefined,
        },
      });

      await started;
      expect(slowListing).toBe(true);
      expect(companiesWhenJdStarted).toBe(1);
      releaseListing();
      releaseJd();
      const report = await pending;
      expect(report.urls).toEqual([alpha.url, beta.url]);
      expect(snapshots.at(-1)).toMatchObject({ completed: 2, total: 2, companiesDone: 2, companiesTotal: 2 });
    } finally {
      releaseListing();
      releaseJd();
    }
  });

  it("does not bypass or deadlock the shared Workday host limit", async () => {
    const externalUrl = "https://lock.wd1.myworkdayjobs.com/en-US/external/job/Engineer_R1000";
    const internalUrl = "https://lock.wd1.myworkdayjobs.com/en-US/internal/job/Analyst_R2000";
    const external = workdayBoard.formCompany(new URL(externalUrl));
    const internal = workdayBoard.formCompany(new URL(internalUrl));
    expect(companyKey(external)).toBe(companyKeyFromUrl(new URL(externalUrl)));
    expect(companyKey(internal)).toBe(companyKeyFromUrl(new URL(internalUrl)));
    expect(companyKey(external)).not.toBe(companyKey(internal));

    const order: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const occupy = async (label: string) => {
      order.push(label);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight--;
    };

    const pending = runClean({
      urls: [externalUrl, internalUrl],
      companies: [external, internal],
      hooks: {
        checkListing: async (company) => {
          await occupy(`listing:${company.identifier}`);
          return {
            listed: [],
            unverified: [company.identifier.endsWith("internal") ? internalUrl : externalUrl],
          };
        },
        fetchJd: async (url) => {
          await occupy(`jd:${url.includes("/internal/") ? "internal" : "external"}`);
          return ok();
        },
      },
    });
    const raced = await Promise.race([
      pending.then((report) => ({ report, timedOut: false as const })),
      new Promise<{ timedOut: true }>((resolve) => setTimeout(() => resolve({ timedOut: true }), 1500)),
    ]);

    expect(raced.timedOut).toBe(false);
    if (raced.timedOut) return;
    expect(maxInFlight).toBe(1);
    const listingAt = order.findIndex((event) => event.startsWith("listing:"));
    let lastListing = -1;
    for (let index = 0; index < order.length; index++) {
      if (order[index]?.startsWith("listing:")) lastListing = index;
    }
    const firstJd = order.findIndex((event) => event.startsWith("jd:"));
    expect(listingAt).toBeGreaterThanOrEqual(0);
    expect(lastListing).toBeLessThan(firstJd);
    expect(raced.report.urls).toEqual([externalUrl, internalUrl]);
    await pending;
  }, 5_000);

  it("stops paging once the listing has every target and still confirms a miss", async () => {
    const company: Company = {
      name: "acme",
      ats: "workday",
      identifier: "acme-external",
      domain: "https://acme.wd1.myworkdayjobs.com/en-US/external",
      page: "https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/external/jobs",
      urls: [],
    };
    const hit = "https://acme.wd1.myworkdayjobs.com/en-US/external/job/Engineer_R1000";
    const miss = "https://acme.wd1.myworkdayjobs.com/en-US/external/job/Missing_R9999";
    expect(companyKey(company)).toBe(companyKeyFromUrl(new URL(hit)));
    const calls: number[] = [];

    vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { offset: number };
      calls.push(body.offset);
      const ids =
        body.offset === 0
          ? Array.from({ length: 20 }, (_, index) => (index === 0 ? "R1000" : `R3${index.toString().padStart(3, "0")}`))
          : ["R4000", "R4001"];
      return http(
        200,
        JSON.stringify({
          jobPostings: ids.map((id) => ({
            title: `Role ${id}`,
            postedOn: "Posted Yesterday",
            locationsText: "Remote",
            externalPath: `/job/Role_${id}`,
          })),
        }),
        company.page,
        "application/json"
      );
    });

    const found = await runClean({
      urls: [hit],
      companies: [company],
      hooks: {
        fetchJd: async () => {
          throw new Error("listed URL was sent to JD");
        },
      },
    });
    expect(calls).toEqual([0]);
    expect(found.listingPages).toBe(1);
    expect(found.listingHits).toBe(1);
    expect(found.jdAttempts).toBe(0);
    expect(found.urls).toEqual([hit]);

    calls.length = 0;
    const partial = await runClean({
      urls: [hit, miss],
      companies: [company],
      hooks: {
        fetchJd: async (url) => {
          expect(url).toBe(miss);
          return status(503, "Service Unavailable");
        },
        sleep: async () => undefined,
      },
    });
    expect(calls).toEqual([0, 20]);
    expect(partial.listingPages).toBe(2);
    expect(partial.listingHits).toBe(1);
    expect(partial.jdAttempts).toBe(1);
    expect(partial.dropped).toEqual([]);
    expect(partial.urls).toEqual([hit, miss]);
  });

  it("counts a URL once and does not count a queued JD as finished", async () => {
    const listed = "https://jobs.lever.co/acme/11111111-1111-4111-8111-111111111111";
    const pending = "https://jobs.lever.co/acme/22222222-2222-4222-8222-222222222222";
    const company = leverBoard.formCompany(new URL(listed));
    const snapshots: CleanProgress[] = [];
    let clock = 1_000;

    const report = await runClean({
      urls: [listed, listed, pending],
      companies: [company],
      hooks: {
        now: () => clock,
        sleep: async () => undefined,
        onProgress: (progress) => snapshots.push({ ...progress }),
        checkListing: async () => ({ listed: [listed], unverified: [pending] }),
        fetchJd: async () => {
          const during = snapshots.at(-1);
          expect(during?.completed).toBe(1);
          expect(during?.jdPending).toBe(0);
          expect(during?.jdActive).toBe(1);
          clock = 6_000;
          return ok();
        },
      },
    });

    expect(snapshots.some((progress) => progress.completed === 1 && progress.jdPending === 1 && progress.jdActive === 0)).toBe(true);
    expect(report.urls).toEqual([listed, pending]);
    expect(report.elapsedMs).toBe(5_000);
    expect(report.jdAttempts).toBe(1);
    expect(snapshots.at(-1)).toMatchObject({ completed: 2, total: 2 });
    expect(Math.max(...snapshots.map((progress) => progress.completed))).toBe(2);

    const measured = cleanMeasured(logSpy.mock.calls);
    expect(measured).toMatchObject({ elapsedMs: 5_000, listingHits: 1, jdAttempts: 1, kept: 2 });
    expect(measured).not.toHaveProperty("eta");
    expect(cleanMeasuredText(logSpy.mock.calls)).toContain('"queueMs"');
    expect(cleanMeasuredText(logSpy.mock.calls)).not.toContain("[Object]");
    for (const call of logSpy.mock.calls) {
      if (typeof call[0] === "string") expect(call[0]).not.toMatch(/eta/i);
    }
  });

  it("counts one retry from the fake clock and then keeps the URL", async () => {
    const url = "https://jobs.lever.co/acme/11111111-1111-4111-8111-111111111111";
    let clock = 0;
    let calls = 0;
    const sleeps: number[] = [];

    const report = await runClean({
      urls: [url],
      companies: [],
      hooks: {
        now: () => clock,
        random: () => 0,
        sleep: async (ms) => {
          sleeps.push(ms);
          clock += ms;
        },
        fetchJd: async () => {
          calls++;
          if (calls === 1) return status(429, "Too Many Requests");
          return ok();
        },
      },
    });

    expect(sleeps).toEqual([2000]);
    expect(report.jdAttempts).toBe(2);
    expect(report.retries).toBe(1);
    expect(report.urls).toEqual([url]);
    expect(report.elapsedMs).toBe(2000);
    expect(report.unknown).toBe(0);
  });

  it("logs non-TTY progress every 30 seconds and clears the timer when the run settles", async () => {
    const tty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: false });
    vi.useFakeTimers();
    const url = "https://jobs.lever.co/acme/11111111-1111-4111-8111-111111111111";
    let releaseJd = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseJd = resolve;
    });
    let arm = false;
    const statusLines = () =>
      logSpy.mock.calls
        .map((call: unknown[]) => call[0])
        .filter((entry: unknown): entry is string => typeof entry === "string" && entry.startsWith("clean "));

    const pending = runClean({
      urls: [url],
      companies: [],
      hooks: {
        sleep: async () => undefined,
        now: () => 0,
        onProgress: () => {
          if (arm) throw new Error("progress failed");
        },
        fetchJd: async () => {
          await gate;
          arm = true;
          return ok();
        },
      },
    });

    try {
      await vi.advanceTimersByTimeAsync(29_000);
      expect(statusLines()).toEqual([]);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(statusLines()).toHaveLength(1);
      expect(statusLines()[0]).not.toMatch(/eta/i);
      expect(statusLines()[0]).not.toMatch(/queueMs|byAts|slowest/);

      releaseJd();
      await expect(pending).rejects.toThrow("progress failed");
      const settled = statusLines().length;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(statusLines()).toHaveLength(settled);
    } finally {
      releaseJd();
      vi.useRealTimers();
      if (tty) Object.defineProperty(process.stdout, "isTTY", tty);
      else Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: undefined });
    }
  });

  it("keeps parallel clean runs from sharing a Greenhouse slug listing", async () => {
    const slugA = "https://job-boards.greenhouse.io/acme/software-engineer-intern";
    const slugB = "https://job-boards.greenhouse.io/acme/data-scientist-intern";
    let listCalls = 0;
    let releaseList: (response: Response) => void = () => {};
    const listGate = new Promise<Response>((resolve) => {
      releaseList = resolve;
    });
    let ready = 0;
    let markReady: () => void = () => {};
    const readyGate = new Promise<void>((resolve) => {
      markReady = () => {
        ready++;
        if (ready === 2) resolve();
      };
    });

    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/acme/jobs")) {
        listCalls++;
        markReady();
        return listGate;
      }
      return Promise.resolve(http(200, JSON.stringify({ content: "Engineer" }), url, "application/json"));
    });

    const run = (url: string) =>
      runClean({
        urls: [url],
        companies: [],
        hooks: { sleep: async () => undefined, random: () => 0 },
      });
    const pending = Promise.all([run(slugA), run(slugB)]);

    try {
      await readyGate;
      expect(listCalls).toBe(2);
      releaseList(
        http(
          200,
          JSON.stringify({
            jobs: [
              { id: 11, title: "Software Engineer Intern" },
              { id: 22, title: "Data Scientist Intern" },
            ],
          }),
          "https://boards-api.greenhouse.io/v1/boards/acme/jobs",
          "application/json"
        )
      );
      const [first, second] = await pending;
      expect(first.slugRequests).toBe(1);
      expect(second.slugRequests).toBe(1);
      expect(first.jdAttempts).toBe(1);
      expect(second.jdAttempts).toBe(1);

      const again = await run(slugA);
      expect(again.slugRequests).toBe(1);
      expect(listCalls).toBe(3);
    } finally {
      releaseList(new Response("", { status: 500, statusText: "Internal Server Error" }));
    }
  });

  it("keeps accumulated listing time distinct from wall-clock elapsed", async () => {
    const alpha = lever("alpha", "11111111-1111-4111-8111-111111111111");
    const beta = lever("beta", "22222222-2222-4222-8222-222222222222");
    let clock = 0;
    let entered = 0;
    let release = () => {};
    const bothEntered = new Promise<void>((resolve) => {
      release = resolve;
    });

    const report = await runClean({
      urls: [alpha.url, beta.url],
      companies: [alpha.company, beta.company],
      hooks: {
        now: () => clock,
        sleep: async () => undefined,
        fetchJd: async () => ok(),
        checkListing: async (_company, urls) => {
          const start = clock;
          entered++;
          if (entered === 2) release();
          await bothEntered;
          clock = Math.max(clock, start + 1_000);
          return { listed: [...urls], unverified: [] };
        },
      },
    });

    expect(report.elapsedMs).toBe(1_000);
    expect(report.jdAttempts).toBe(0);
    expect(report.byAts).toEqual([
      {
        ats: "lever",
        urls: 2,
        listingHits: 2,
        jdAttempts: 0,
        retries: 0,
        unknown: 0,
        listing: { queueMs: 0, busyMs: 2_000, backoffMs: 0 },
        jd: { queueMs: 0, busyMs: 0, backoffMs: 0 },
      },
    ]);
    expect(report.timingNote).toBe(
      "queueMs, busyMs, and backoffMs sum parallel work. They are not wall-clock elapsedMs."
    );
    const measuredText = cleanMeasuredText(logSpy.mock.calls);
    expect(measuredText).toContain('"listing"');
    expect(measuredText).toContain('"busyMs": 2000');
    expect(measuredText).not.toContain("[Object]");
    expect(cleanMeasured(logSpy.mock.calls)?.timingNote).toBe(report.timingNote);
  });

  it("records retry backoff separately from JD busy time", async () => {
    const url = "https://jobs.lever.co/acme/11111111-1111-4111-8111-111111111111";
    let clock = 0;
    let calls = 0;

    const report = await runClean({
      urls: [url],
      companies: [],
      hooks: {
        now: () => clock,
        random: () => 0,
        sleep: async (ms) => {
          clock += ms;
        },
        fetchJd: async () => {
          clock += 50;
          calls++;
          return calls === 1 ? status(429, "Too Many Requests") : ok();
        },
      },
    });

    expect(report.jdAttempts).toBe(2);
    expect(report.retries).toBe(1);
    expect(report.unknown).toBe(0);
    expect(report.elapsedMs).toBe(2_100);
    expect(report.byAts[0]?.jd).toEqual({ queueMs: 0, busyMs: 100, backoffMs: 2_000 });
    expect(report.unknownReasons).toEqual({
      "429": 0,
      timeout: 0,
      network: 0,
      "401/403": 0,
      "5xx": 0,
      "closed-or-unparsed": 0,
      other: 0,
    });
    expect(report.slowestHosts[0]).toMatchObject({
      host: "jobs.lever.co",
      busyMs: 100,
      backoffMs: 2_000,
      retries: 1,
      unknown: 0,
    });
  });

  it("counts Workday queue time apart from listing busy time", async () => {
    const externalUrl = "https://lock.wd1.myworkdayjobs.com/en-US/external/job/Engineer_R1000";
    const internalUrl = "https://lock.wd1.myworkdayjobs.com/en-US/internal/job/Analyst_R2000";
    let clock = 0;
    let held = 0;
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });

    const pending = runClean({
      urls: [externalUrl, internalUrl],
      companies: [
        workdayBoard.formCompany(new URL(externalUrl)),
        workdayBoard.formCompany(new URL(internalUrl)),
      ],
      hooks: {
        now: () => clock,
        random: () => 0,
        sleep: async (ms) => {
          clock += ms;
        },
        fetchJd: async () => ok(),
        checkListing: async (_company, urls) => {
          held++;
          if (held === 1) {
            await hold;
            clock += 400;
          } else {
            clock += 50;
          }
          return { listed: [...urls], unverified: [] };
        },
      },
    });

    await vi.waitFor(() => expect(held).toBe(1));
    release();
    const report = await pending;

    expect(report.elapsedMs).toBe(450);
    expect(report.jdAttempts).toBe(0);
    expect(report.byAts).toEqual([
      {
        ats: "workday",
        urls: 2,
        listingHits: 2,
        jdAttempts: 0,
        retries: 0,
        unknown: 0,
        listing: { queueMs: 400, busyMs: 450, backoffMs: 0 },
        jd: { queueMs: 0, busyMs: 0, backoffMs: 0 },
      },
    ]);
    expect(report.slowestHosts).toEqual([
      {
        host: "lock.wd1.myworkdayjobs.com",
        accumulatedMs: 850,
        queueMs: 400,
        busyMs: 450,
        backoffMs: 0,
        retries: 0,
        unknown: 0,
      },
    ]);
    expect(report.slowestCompanies).toHaveLength(2);
    expect(report.slowestCompanies.reduce((sum, row) => sum + row.accumulatedMs, 0)).toBe(850);
  });

  it("ranks the slowest 10 companies and separates host queue time from busy time", async () => {
    const urls = Array.from({ length: 12 }, (_, index) => {
      const board = `board${String(index + 1).padStart(2, "0")}`;
      return `https://slow.wd1.myworkdayjobs.com/en-US/${board}/job/Role_R${index + 1}`;
    });
    const companies = urls.map((url) => workdayBoard.formCompany(new URL(url)));
    let clock = 0;

    const report = await runClean({
      urls,
      companies,
      hooks: {
        now: () => clock,
        sleep: async () => undefined,
        random: () => 0,
        checkListing: async (_company, companyUrls) => ({ listed: [], unverified: [...companyUrls] }),
        fetchJd: async (url) => {
          const parts = new URL(url).pathname.split("/").filter(Boolean);
          const board = parts[parts.indexOf("job") - 1] ?? "";
          clock += Number(board.slice(5)) * 10;
          return status(422, "Unprocessable Entity");
        },
      },
    });

    expect(report.elapsedMs).toBe(780);
    expect(report.byAts).toEqual([
      {
        ats: "workday",
        urls: 12,
        listingHits: 0,
        jdAttempts: 12,
        retries: 0,
        unknown: 12,
        listing: { queueMs: 0, busyMs: 0, backoffMs: 0 },
        jd: { queueMs: 2_860, busyMs: 780, backoffMs: 0 },
      },
    ]);
    expect(report.unknownReasons.other).toBe(12);
    expect(report.slowestCompanies.map((row) => row.company)).toEqual(
      [12, 11, 10, 9, 8, 7, 6, 5, 4, 3].map((n) => `slow (workday:slow-board${String(n).padStart(2, "0")})`)
    );
    expect(report.slowestCompanies[0]).toMatchObject({
      host: "slow.wd1.myworkdayjobs.com",
      queueMs: 660,
      busyMs: 120,
      backoffMs: 0,
      accumulatedMs: 780,
      retries: 0,
      unknown: 1,
    });
    expect(report.slowestCompanies[9]).toMatchObject({ queueMs: 30, busyMs: 30, accumulatedMs: 60 });
    expect(report.slowestCompanies.map((row) => row.company)).not.toContain("slow (workday:slow-board01)");
    expect(report.slowestHosts).toEqual([
      {
        host: "slow.wd1.myworkdayjobs.com",
        accumulatedMs: 3_640,
        queueMs: 2_860,
        busyMs: 780,
        backoffMs: 0,
        retries: 0,
        unknown: 12,
      },
    ]);
    expect(report.slowestHosts[0]?.accumulatedMs).toBeGreaterThan(report.elapsedMs);
  });

  it("classifies unknown reasons from fake fetch without reading error text", async () => {
    const posting = (name: string) => `https://jobs.lever.co/${name}/11111111-1111-4111-8111-111111111111`;
    const timedOut = posting("timed");
    const worded = posting("worded");
    const denied = posting("denied");
    const closed = posting("closed");
    const server = posting("server");
    const limited = posting("limited");
    const gone = posting("gone");
    const httpTimeout = posting("http-timeout");
    let clock = 0;

    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input);
      clock += 10;
      if (url.includes("/timed/")) {
        const error = new Error("socket hang up");
        error.name = "TimeoutError";
        return Promise.reject(error);
      }
      if (url.includes("/worded/")) return Promise.reject(new Error("The operation was aborted due to timeout"));
      if (url.includes("/denied/")) return Promise.resolve(http(401, "", url));
      if (url.includes("/closed/")) {
        return Promise.resolve(http(200, "<html><body>This job is no longer available</body></html>", url));
      }
      if (url.includes("/server/")) return Promise.resolve(http(500, "", url));
      if (url.includes("/limited/")) return Promise.resolve(http(429, "", url));
      if (url.includes("/gone/")) return Promise.resolve(http(404, "", url));
      if (url.includes("/http-timeout/")) return Promise.resolve(http(408, "", url));
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    const report = await runClean({
      urls: [timedOut, worded, denied, closed, server, limited, gone, httpTimeout],
      companies: [],
      hooks: {
        now: () => clock,
        random: () => 0,
        sleep: async (ms) => {
          clock += ms;
        },
      },
    });

    expect(report.dropped).toEqual([gone]);
    expect(report.unknown).toBe(7);
    expect(report.unknownReasons).toEqual({
      "429": 1,
      timeout: 2,
      network: 1,
      "401/403": 1,
      "5xx": 1,
      "closed-or-unparsed": 1,
      other: 0,
    });
    expect(report.jdAttempts).toBe(26);
    const leverStats = report.byAts.find((row) => row.ats === "lever");
    expect(leverStats).toMatchObject({ urls: 8, jdAttempts: 26, retries: 18, unknown: 7 });
    expect(leverStats?.jd.backoffMs).toBeGreaterThanOrEqual(3 * 122_000);
    expect(leverStats?.jd.backoffMs).toBeGreaterThan(leverStats?.jd.busyMs ?? 0);
    const accumulated =
      (leverStats?.listing.queueMs ?? 0) +
      (leverStats?.listing.busyMs ?? 0) +
      (leverStats?.listing.backoffMs ?? 0) +
      (leverStats?.jd.queueMs ?? 0) +
      (leverStats?.jd.busyMs ?? 0) +
      (leverStats?.jd.backoffMs ?? 0);
    expect(accumulated).toBeGreaterThanOrEqual(report.elapsedMs);
    expect(report.slowestHosts[0]?.host).toBe("jobs.lever.co");
    expect(report.slowestHosts[0]?.retries).toBe(18);
    expect(report.slowestHosts[0]?.unknown).toBe(7);
    expect(report.slowestCompanies.length).toBeLessThanOrEqual(10);
  });

  it("prints nested listing time and attributes a Dexcom alias listing to Workday", async () => {
    const listed = "https://careers.dexcom.com/careers/job/37990370";
    const pending = "https://careers.dexcom.com/careers/job/37990371";
    const dexcom: Company = {
      name: "dexcom",
      ats: "workday",
      identifier: "dexcom-dexcom",
      domain: "https://dexcom.wd1.myworkdayjobs.com/Dexcom",
      page: "https://dexcom.wd1.myworkdayjobs.com/wday/cxs/dexcom/Dexcom/jobs",
      urls: [],
    };
    let clock = 0;
    let listedOn = "";
    logSpy.mockRestore();
    const lines: string[] = [];
    const originalLog = console.log.bind(console);
    const log = vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      if (typeof message === "string") lines.push(message);
      originalLog(message);
    });

    try {
      const report = await runClean({
        urls: [listed, pending],
        companies: [dexcom],
        hooks: {
          now: () => clock,
          sleep: async () => undefined,
          random: () => 0,
          checkListing: async (company, urls) => {
            listedOn = company.page;
            expect(company.ats).toBe("workday");
            clock += 500;
            return { listed: [listed], unverified: urls.filter((url) => url !== listed) };
          },
          fetchJd: async (url) => {
            expect(url).toBe(pending);
            clock += 80;
            return ok();
          },
        },
      });

      const text = lines.join("\n");
      expect(text.match(/Clean measured/g)).toHaveLength(1);
      expect(text).not.toContain("[Object]");
      expect(text).toContain('"ats": "workday"');
      expect(text).toMatch(/"listing": \{\s+"queueMs": 0,\s+"busyMs": 500,\s+"backoffMs": 0/);
      expect(text).toContain("company.page");
      const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as {
        byAts: unknown;
      };
      expect(parsed.byAts).toEqual(report.byAts);
      expect(report.byAts).toEqual([
        {
          ats: "none",
          urls: 2,
          listingHits: 1,
          jdAttempts: 1,
          retries: 0,
          unknown: 0,
          listing: { queueMs: 0, busyMs: 0, backoffMs: 0 },
          jd: { queueMs: 0, busyMs: 80, backoffMs: 0 },
        },
        {
          ats: "workday",
          urls: 0,
          listingHits: 0,
          jdAttempts: 0,
          retries: 0,
          unknown: 0,
          listing: { queueMs: 0, busyMs: 500, backoffMs: 0 },
          jd: { queueMs: 0, busyMs: 0, backoffMs: 0 },
        },
      ]);
      expect(report.attribution).toContain("stored URL");
      expect(report.attribution).toContain("company.ats");
      expect(listedOn).toBe(dexcom.page);
      expect(report.slowestHosts).toEqual([
        {
          host: "dexcom.wd1.myworkdayjobs.com",
          accumulatedMs: 500,
          queueMs: 0,
          busyMs: 500,
          backoffMs: 0,
          retries: 0,
          unknown: 0,
        },
        {
          host: "careers.dexcom.com",
          accumulatedMs: 80,
          queueMs: 0,
          busyMs: 80,
          backoffMs: 0,
          retries: 0,
          unknown: 0,
        },
      ]);
    } finally {
      log.mockRestore();
    }
  });

  it("classifies HTTP 200 invalid JSON as unparsed and a connection error as network", async () => {
    const broken = "https://boards.greenhouse.io/acme/jobs/9001";
    const offline = "https://boards.greenhouse.io/acme/jobs/9002";
    const calls: string[] = [];
    let clock = 0;

    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/jobs/9001")) {
        return Promise.resolve(new Response("not-json", { status: 200, statusText: "OK" }));
      }
      if (url.endsWith("/jobs/9002")) return Promise.reject(new TypeError("fetch failed"));
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    const report = await runClean({
      urls: [broken, offline],
      companies: [],
      hooks: {
        now: () => clock,
        random: () => 0,
        sleep: async (ms) => {
          clock += ms;
        },
      },
    });

    expect(report.dropped).toEqual([]);
    expect(report.urls).toEqual([broken, offline]);
    expect(report.unknown).toBe(2);
    expect(report.jdAttempts).toBe(14);
    expect(report.retries).toBe(12);
    expect(report.unknownReasons["closed-or-unparsed"]).toBe(1);
    expect(report.unknownReasons.network).toBe(1);
    expect(calls.filter((url) => url.endsWith("/jobs/9001"))).toHaveLength(7);
    expect(calls.filter((url) => url.endsWith("/jobs/9002"))).toHaveLength(7);
    expect(calls.some((url) => url.includes("boards.greenhouse.io"))).toBe(false);
  });

  it("replaces Apple JD attempts with listing hits for the same fixture", async () => {
    const onFirstPage = "https://jobs.apple.com/en-us/details/111111111/role?team=SFTWR";
    const onSecondPage = "https://jobs.apple.com/en-us/details/222222222/role?team=SFTWR";
    const absent = "https://jobs.apple.com/en-us/details/333333333/role?team=SFTWR";
    const urls = [onFirstPage, onSecondPage, absent];
    const card = (id: string) =>
      `<li><a href="/en-us/details/${id}/role">Software Engineer Intern</a><span class="job-posted-date">Jan 1, 2020</span></li>`;
    const page = (body: string, status = 200) =>
      new Response(`<ul id="search-job-list">${body}</ul>`, {
        status,
        statusText: status === 200 ? "OK" : "Error",
        headers: { "content-type": "text/html" },
      });
    const jd = vi.fn(async (url: string) => {
      expect(url).toContain("jobs.apple.com");
      return ok();
    });

    const before = await runClean({
      urls,
      companies: [AppleCompany],
      hooks: {
        sleep: async () => undefined,
        random: () => 0,
        checkListing: async (_company, companyUrls) => ({ listed: [], unverified: [...companyUrls] }),
        fetchJd: jd,
      },
    });

    expect(before.listingPages).toBe(0);
    expect(before.listingHits).toBe(0);
    expect(before.jdAttempts).toBe(3);
    expect(jd).toHaveBeenCalledTimes(3);

    const requested: string[] = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const number = url.searchParams.get("page") ?? "";
      requested.push(number);
      if (number === "1") return Promise.resolve(page(card("111111111")));
      if (number === "2") return Promise.resolve(page(card("222222222")));
      if (number === "3") return Promise.resolve(page(""));
      return Promise.reject(new Error(`unexpected page ${number}`));
    });
    jd.mockClear();

    const after = await runClean({
      urls,
      companies: [AppleCompany],
      hooks: { sleep: async () => undefined, random: () => 0, fetchJd: jd },
    });

    expect(requested).toEqual(["1", "2", "3"]);
    expect(after.listingPages).toBe(3);
    expect(after.listingHits).toBe(2);
    expect(after.jdAttempts).toBe(1);
    expect(jd.mock.calls.map((call) => call[0])).toEqual([absent]);
    expect(after.byAts.find((row) => row.ats === "custom")).toMatchObject({
      urls: 3,
      listingHits: 2,
      jdAttempts: 1,
    });
    expect(before.jdAttempts - after.jdAttempts).toBe(2);
  });

  it("skips the JD when the Apple URL is on the first listing page", async () => {
    const url = "https://jobs.apple.com/en-us/details/111111111/role?team=SFTWR";
    const requested: string[] = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const page = new URL(String(input)).searchParams.get("page") ?? "";
      requested.push(page);
      if (page !== "1") return Promise.reject(new Error(`unexpected page ${page}`));
      return Promise.resolve(
        new Response(
          `<ul id="search-job-list"><li><a href="/en-us/details/111111111/role">Software Engineer Intern</a></li></ul>`,
          { status: 200, headers: { "content-type": "text/html" } }
        )
      );
    });

    const report = await runClean({
      urls: [url],
      companies: [AppleCompany],
      hooks: {
        sleep: async () => undefined,
        random: () => 0,
        fetchJd: async () => {
          throw new Error("JD was requested");
        },
      },
    });

    expect(requested).toEqual(["1"]);
    expect(report.listingPages).toBe(1);
    expect(report.listingHits).toBe(1);
    expect(report.jdAttempts).toBe(0);
  });

  it("confirms an Apple URL found on a later page and sends the rest to JD when that page fails", async () => {
    const early = "https://jobs.apple.com/en-us/details/111111111/role";
    const later = "https://jobs.apple.com/en-us/details/222222222/role?team=SFTWR";
    const missing = "https://jobs.apple.com/en-us/details/333333333/role";
    const card = (id: string) =>
      `<li><a href="/en-us/details/${id}/role">Software Engineer Intern</a><span class="job-posted-date">Jan 1, 2020</span></li>`;

    const crossPages: string[] = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const page = new URL(String(input)).searchParams.get("page") ?? "";
      crossPages.push(page);
      if (page === "1") {
        return Promise.resolve(
          new Response(`<ul id="search-job-list">${card("999999999")}</ul>`, { status: 200 })
        );
      }
      if (page === "2") {
        return Promise.resolve(
          new Response(`<ul id="search-job-list">${card("222222222")}</ul>`, { status: 200 })
        );
      }
      return Promise.reject(new Error(`unexpected page ${page}`));
    });

    const cross = await runClean({
      urls: [later],
      companies: [AppleCompany],
      hooks: {
        sleep: async () => undefined,
        random: () => 0,
        fetchJd: async () => {
          throw new Error("JD was requested");
        },
      },
    });

    expect(crossPages).toEqual(["1", "2"]);
    expect(cross.listingPages).toBe(2);
    expect(cross.listingHits).toBe(1);
    expect(cross.jdAttempts).toBe(0);

    const failedPages: string[] = [];
    const jdUrls: string[] = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const page = new URL(String(input)).searchParams.get("page") ?? "";
      failedPages.push(page);
      if (page === "1") {
        return Promise.resolve(
          new Response(`<ul id="search-job-list">${card("111111111")}</ul>`, { status: 200 })
        );
      }
      if (page === "2") return Promise.resolve(new Response("", { status: 500, statusText: "Error" }));
      return Promise.reject(new Error(`unexpected page ${page}`));
    });

    const failed = await runClean({
      urls: [early, missing],
      companies: [AppleCompany],
      hooks: {
        sleep: async () => undefined,
        random: () => 0,
        fetchJd: async (url: string) => {
          jdUrls.push(url);
          return ok();
        },
      },
    });

    expect(failedPages).toEqual(["1", "2"]);
    expect(failed.listingPages).toBe(2);
    expect(failed.listingHits).toBe(1);
    expect(failed.jdAttempts).toBe(1);
    expect(jdUrls).toEqual([missing]);
  });
});

describe("unknownReason", () => {
  it("keeps structured causes and does not guess from the message", () => {
    expect(unknownReason({ code: 429, desc: "please retry later" })).toBe("429");
    expect(unknownReason({ code: 408, desc: "Request Timeout" })).toBe("timeout");
    expect(unknownReason({ code: 0, desc: "The operation was aborted due to timeout" })).toBe("network");
    expect(unknownReason({ code: 0, desc: "socket hang up", failure: "timeout" })).toBe("timeout");
    expect(unknownReason({ code: 0, desc: "ECONNRESET" })).toBe("network");
    expect(unknownReason({ code: 401, desc: "Unauthorized" })).toBe("401/403");
    expect(unknownReason({ code: 403, desc: "Forbidden" })).toBe("401/403");
    expect(unknownReason({ code: 500, desc: "Internal Server Error" })).toBe("5xx");
    expect(unknownReason({ code: 503, desc: "unavailable" })).toBe("5xx");
    expect(unknownReason(JD_FETCH_ERROR.noData())).toBe("closed-or-unparsed");
    expect(unknownReason(JD_FETCH_ERROR.invalidUrl("Job ID not found"))).toBe("closed-or-unparsed");
    expect(unknownReason({ code: 404, desc: "No data in response" })).toBe("closed-or-unparsed");
    expect(unknownReason({ code: 400, desc: "Invalid Workday URL" })).toBe("other");
    expect(unknownReason({ code: 422, desc: "Unprocessable Entity" })).toBe("other");
    expect(unknownReason({ code: 0, desc: "Unexpected token < in JSON at position 0" })).toBe("network");
    expect(
      unknownReason({ code: 0, desc: "Unexpected token < in JSON at position 0", failure: "invalid" })
    ).toBe("closed-or-unparsed");
  });
});

describe("cleanUrls", () => {
  beforeEach(() => {
    logger.level = "silent";
    mocks.urlsLoad.mockReset().mockResolvedValue(new Set());
    mocks.urlsSave.mockReset().mockResolvedValue(undefined);
    mocks.opportunitiesLoad.mockReset().mockResolvedValue([]);
    mocks.opportunitiesReplace.mockReset().mockResolvedValue(undefined);
    mocks.companiesLoad.mockReset().mockResolvedValue([]);
    mocks.deduplicate.mockReset().mockResolvedValue(undefined);
    mocks.errorLogAppend.mockReset().mockResolvedValue(undefined);
    mocks.buildCompanyList.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", () => {
      throw new Error("unexpected network");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("writes through the mocked store only after an empty clean", async () => {
    const order: string[] = [];
    mocks.deduplicate.mockImplementation(async () => {
      order.push("dedup");
    });
    mocks.urlsSave.mockImplementation(async () => {
      order.push("urls");
    });
    mocks.opportunitiesReplace.mockImplementation(async () => {
      order.push("opportunities");
    });
    mocks.buildCompanyList.mockImplementation(async () => {
      order.push("build");
    });

    await expect(cleanUrls()).resolves.toEqual([]);
    expect(order).toEqual(["dedup", "urls", "opportunities", "build"]);
    expect(mocks.urlsSave).toHaveBeenCalledWith(new Set());
    expect(mocks.errorLogAppend).not.toHaveBeenCalled();
  });
});
