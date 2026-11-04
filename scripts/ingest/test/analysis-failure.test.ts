import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Job } from "@/types";
import type * as DataUtils from "@/utils/data";

import { HttpStatusCode, JD_FETCH_ERROR, JD_FETCH_OK } from "@/modules/posting/jd";
import { Posting } from "@/modules/posting/posting";

const analyzeJDMock = vi.hoisted(() => vi.fn());
const dataMocks = vi.hoisted(() => ({
  loadOpportunities: vi.fn(),
  saveOpportunities: vi.fn(),
  saveJob: vi.fn(),
  saveUrls: vi.fn(),
}));
const enqueueBatchJobsMock = vi.hoisted(() => vi.fn());
const buildCompanyListMock = vi.hoisted(() => vi.fn());
const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/modules/posting/analysis/ai", () => ({
  default: analyzeJDMock,
  analyzeQualifications: vi.fn(),
}));

vi.mock("@/utils/data", async (importOriginal) => {
  const actual = await importOriginal<typeof DataUtils>();
  return { ...actual, ...dataMocks };
});

vi.mock("@/modules/posting/batch", () => ({
  enqueueBatchJobs: enqueueBatchJobsMock,
}));

vi.mock("@/modules/employer/build", () => ({
  buildCompanyList: buildCompanyListMock,
}));

vi.mock("@/utils/logger", () => ({
  logger: loggerMocks,
}));

import { processJobs } from "../index";

const getRawJDSpy = vi.spyOn(Posting.prototype, "getRawJD");

const job: Job = {
  company: "Acme",
  role: "Account Executive",
  link: "https://careers.example.com/jobs/1",
  location: "Austin, TX",
};

function errorMessages() {
  return loggerMocks.error.mock.calls.map(([, message]) => message as string);
}

async function ingestTwice() {
  const context = { urls: new Set<string>(), keys: new Set<string>(), currentId: 0 };
  const first = await processJobs({ jobs: [job], ...context });
  const second = await processJobs({ jobs: [job], ...context });
  return { first, second, context };
}

function expectUnseenFailure(result: Awaited<ReturnType<typeof processJobs>>) {
  expect(result).toMatchObject({ count: 0, failed: 1, skipped: 0, batched: 0 });
  expect(dataMocks.saveUrls).toHaveBeenCalledWith(new Set());
  expect(dataMocks.saveJob).toHaveBeenCalledWith([]);
  expect(dataMocks.saveOpportunities).not.toHaveBeenCalled();
  expect(buildCompanyListMock).not.toHaveBeenCalled();
  expect(enqueueBatchJobsMock).not.toHaveBeenCalled();
}

describe("ingest analysis failures", () => {
  beforeEach(() => {
    vi.stubEnv("AI_MODE", undefined);
    analyzeJDMock.mockReset();
    getRawJDSpy.mockReset().mockResolvedValue({ jd: "Acme is hiring.", error: JD_FETCH_OK });
    dataMocks.loadOpportunities.mockReset().mockResolvedValue([]);
    dataMocks.saveOpportunities.mockReset().mockResolvedValue(undefined);
    dataMocks.saveJob.mockReset().mockResolvedValue(undefined);
    dataMocks.saveUrls.mockReset().mockResolvedValue(undefined);
    enqueueBatchJobsMock.mockReset().mockResolvedValue(undefined);
    buildCompanyListMock.mockReset().mockResolvedValue(undefined);
    for (const mock of Object.values(loggerMocks)) mock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("routes the job to real-time analysis", () => {
    expect(Posting.from(job).shouldBatchAnalyze()).toBe(false);
  });

  it.each([
    { name: "an empty AI result", result: null, reason: "empty" },
    { name: "a wrongly shaped AI result", result: JSON.stringify({ hello: "world" }), reason: "invalid" },
    { name: "an AI result that is not JSON", result: "not json at all", reason: "unparseable" },
  ])("counts $name as an AI analysis failure and retries next run", async ({ result, reason }) => {
    analyzeJDMock.mockResolvedValue({ result, cost: 0.01 });

    const { first, second, context } = await ingestTwice();

    expectUnseenFailure(first);
    expectUnseenFailure(second);
    expect(context.urls).toEqual(new Set());
    expect(context.keys).toEqual(new Set());
    expect(analyzeJDMock).toHaveBeenCalledTimes(2);
    expect(loggerMocks.error).toHaveBeenCalledWith(
      { company: job.company, role: job.role, url: job.link, reason },
      expect.stringContaining("AI analysis failed")
    );
    expect(errorMessages().some((message) => message.includes("Failed to fetch JD"))).toBe(false);
    for (const [fields] of loggerMocks.error.mock.calls) {
      expect(fields).not.toHaveProperty("code");
    }
  });

  it("logs a real JD 404 as a fetch failure with its HTTP status and retries next run", async () => {
    getRawJDSpy.mockResolvedValue({
      jd: null,
      error: JD_FETCH_ERROR.http(HttpStatusCode.NOT_FOUND, "Not Found"),
    });

    const { first, second, context } = await ingestTwice();

    expectUnseenFailure(first);
    expectUnseenFailure(second);
    expect(context.urls).toEqual(new Set());
    expect(getRawJDSpy).toHaveBeenCalledTimes(2);
    expect(analyzeJDMock).not.toHaveBeenCalled();
    expect(loggerMocks.error).toHaveBeenCalledWith(
      {
        company: job.company,
        role: job.role,
        url: job.link,
        code: HttpStatusCode.NOT_FOUND,
        reason: "Not Found",
      },
      expect.stringContaining("Failed to fetch JD")
    );
    expect(errorMessages().some((message) => message.includes("AI analysis failed"))).toBe(false);
  });
});
