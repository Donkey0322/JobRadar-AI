import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Job } from "@/types";
import type { JD } from "@/types/jobs";

import { HttpStatusCode, JD_FETCH_ERROR, JD_FETCH_OK } from "@/modules/ats/detail";
import { JobCategory } from "@/validation/config";

const dataMocks = vi.hoisted(() => ({
  loadOpportunities: vi.fn().mockResolvedValue([]),
  saveOpportunities: vi.fn().mockResolvedValue(undefined),
  saveJob: vi.fn().mockResolvedValue(undefined),
  saveUrls: vi.fn().mockResolvedValue(undefined),
  loadUrls: vi.fn().mockResolvedValue(new Set<string>()),
  loadJobs: vi.fn().mockResolvedValue([]),
}));

const getJDMock = vi.hoisted(() => vi.fn());
const enqueueBatchJobsMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const shouldBatchAnalyzeMock = vi.hoisted(() => vi.fn().mockReturnValue(false));
const buildCompanyListMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/utils/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/data")>();
  return {
    ...actual,
    ...dataMocks,
  };
});

vi.mock("@/modules/job-analysis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/job-analysis")>();
  return {
    ...actual,
    default: getJDMock,
  };
});

vi.mock("@/modules/job-analysis/batch-queue", () => ({
  enqueueBatchJobs: enqueueBatchJobsMock,
}));

vi.mock("@/modules/ats/core/filter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/ats/core/filter")>();
  return {
    ...actual,
    shouldBatchAnalyze: shouldBatchAnalyzeMock,
  };
});

vi.mock("@/modules/job-discovery/company", () => ({
  buildCompanyList: buildCompanyListMock,
}));

vi.mock("@/utils/logger", () => ({
  logger: loggerMocks,
}));

import { persistAnalyzedJobs, processJobs } from "../index";

const usaJd: JD = {
  citizenship: null,
  sponsorship: null,
  qualifications: ["Bachelor's degree in Computer Science"],
  country: "USA",
  location: "San Francisco, CA, USA",
  category: JobCategory.ENTRY_LEVEL,
  season: "None",
};

function makeJob(id: string): Job {
  return {
    company: "Acme",
    role: "Junior Software Engineer",
    link: `https://job-boards.greenhouse.io/acme/jobs/${id}`,
    location: "San Francisco, CA",
  };
}

function emptyContext() {
  return {
    urls: new Set<string>(),
    keys: new Set<string>(),
    currentId: 0,
  };
}

describe("processJobs", () => {
  beforeEach(() => {
    dataMocks.loadOpportunities.mockReset().mockResolvedValue([]);
    dataMocks.saveOpportunities.mockReset().mockResolvedValue(undefined);
    dataMocks.saveJob.mockReset().mockResolvedValue(undefined);
    dataMocks.saveUrls.mockReset().mockResolvedValue(undefined);
    dataMocks.loadUrls.mockReset().mockResolvedValue(new Set<string>());
    dataMocks.loadJobs.mockReset().mockResolvedValue([]);
    getJDMock.mockReset();
    enqueueBatchJobsMock.mockReset().mockResolvedValue(undefined);
    shouldBatchAnalyzeMock.mockReset().mockReturnValue(false);
    buildCompanyListMock.mockReset().mockResolvedValue(undefined);
    loggerMocks.info.mockReset();
    loggerMocks.error.mockReset();
    loggerMocks.warn.mockReset();
  });

  it("saves eligible jobs with a JD to jobs and opportunities", async () => {
    const job = makeJob("1");
    getJDMock.mockResolvedValue({
      jd: usaJd,
      rawJD: "raw",
      cost: 0.01,
      error: JD_FETCH_OK,
    });

    const result = await processJobs({ jobs: [job], ...emptyContext() });

    expect(result.count).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.jobs[0]).toMatchObject({
      company: "Acme",
      jd: usaJd,
      id: 1,
    });
    expect(dataMocks.saveJob).toHaveBeenCalledWith([
      expect.objectContaining({ link: job.link, jd: usaJd, id: 1 }),
    ]);
    expect(dataMocks.saveOpportunities).toHaveBeenCalledWith([
      expect.objectContaining({ link: job.link, jd: usaJd, expired: false }),
    ]);
    expect(loggerMocks.error).not.toHaveBeenCalled();
    expect(enqueueBatchJobsMock).not.toHaveBeenCalled();
  });

  it("logs an error and does not add jobs when getJD returns no JD", async () => {
    const job = makeJob("404");
    getJDMock.mockResolvedValue({
      jd: null,
      rawJD: "",
      cost: 0,
      error: JD_FETCH_ERROR.noData(),
    });

    const result = await processJobs({ jobs: [job], ...emptyContext() });

    expect(result.count).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.jobs).toEqual([]);
    expect(dataMocks.saveJob).toHaveBeenCalledWith([]);
    expect(dataMocks.saveOpportunities).not.toHaveBeenCalled();
    expect(dataMocks.saveUrls).toHaveBeenCalledWith(new Set());
    expect(buildCompanyListMock).not.toHaveBeenCalled();
    expect(loggerMocks.error).toHaveBeenCalledWith(
      expect.objectContaining({
        company: job.company,
        url: job.link,
        code: HttpStatusCode.NOT_FOUND,
      }),
      expect.stringContaining("Failed to fetch JD")
    );
  });

  it("does not add jobs on network errors or 429", async () => {
    const networkJob = makeJob("net");
    const rateLimitedJob = makeJob("429");

    getJDMock
      .mockResolvedValueOnce({
        jd: null,
        rawJD: "",
        cost: 0,
        error: JD_FETCH_ERROR.fetch("socket hang up"),
      })
      .mockResolvedValueOnce({
        jd: null,
        rawJD: "",
        cost: 0,
        error: JD_FETCH_ERROR.http(HttpStatusCode.TOO_MANY_REQUESTS, "Too Many Requests"),
      });

    const result = await processJobs({
      jobs: [networkJob, rateLimitedJob],
      ...emptyContext(),
    });

    expect(result.failed).toBe(2);
    expect(result.count).toBe(0);
    expect(dataMocks.saveOpportunities).not.toHaveBeenCalled();
    expect(dataMocks.saveJob).toHaveBeenCalledWith([]);
    expect(loggerMocks.error).toHaveBeenCalledTimes(2);
  });

  it("still records location-filtered jobs without a JD so they are not retried", async () => {
    const job = makeJob("india");

    const result = await processJobs({
      jobs: [job],
      ...emptyContext(),
      filter: () => true,
    });

    expect(getJDMock).not.toHaveBeenCalled();
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(dataMocks.saveOpportunities).toHaveBeenCalledWith([
      expect.objectContaining({ link: job.link, expired: false }),
    ]);
    expect(dataMocks.saveJob).toHaveBeenCalledWith([]);
    expect(enqueueBatchJobsMock).not.toHaveBeenCalled();
  });

  it("queues jobs when shouldBatchAnalyze is true", async () => {
    shouldBatchAnalyzeMock.mockReturnValue(true);
    const job = makeJob("senior");
    job.role = "Senior Software Engineer";

    const result = await processJobs({ jobs: [job], ...emptyContext() });

    expect(getJDMock).not.toHaveBeenCalled();
    expect(result.count).toBe(0);
    expect(result.batched).toBe(1);
    expect(enqueueBatchJobsMock).toHaveBeenCalledWith([
      expect.objectContaining({ link: job.link, role: job.role }),
    ]);
    expect(dataMocks.saveJob).toHaveBeenCalledWith([]);
    expect(dataMocks.saveOpportunities).toHaveBeenCalledWith([
      expect.objectContaining({ link: job.link, expired: false }),
    ]);
  });

  it("writes batch-analyzed jobs onto existing opportunities and notifies when eligible", async () => {
    const job = makeJob("batch-1");
    dataMocks.loadOpportunities.mockResolvedValue([
      {
        ...job,
        postedAt: "2026-01-01T00:00:00.000Z",
        expired: false,
      },
    ]);
    dataMocks.loadJobs.mockResolvedValue([{ id: 7 }]);

    const result = await persistAnalyzedJobs([{ job, jd: usaJd, cost: 0.002 }]);

    expect(result.count).toBe(1);
    expect(result.jobs[0]).toMatchObject({ id: 8, jd: usaJd });
    expect(dataMocks.saveJob).toHaveBeenCalledWith([
      expect.objectContaining({ link: job.link, jd: usaJd, id: 8 }),
    ]);
    expect(dataMocks.saveOpportunities).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          link: job.link,
          jd: usaJd,
          postedAt: "2026-01-01T00:00:00.000Z",
        }),
      ],
      true
    );
  });

  it("keeps expanded-dashboard titles on the board without notifying", async () => {
    const job = makeJob("senior");
    job.role = "Senior Software Engineer";

    const result = await persistAnalyzedJobs([{ job, jd: usaJd, cost: 0.002 }]);

    expect(result.count).toBe(0);
    expect(dataMocks.saveJob).toHaveBeenCalledWith([]);
    expect(dataMocks.saveOpportunities).toHaveBeenCalledWith([
      expect.objectContaining({ link: job.link, jd: usaJd, role: job.role }),
    ]);
  });

  it("notifies unspecified-level titles when the JD matches config", async () => {
    const job = makeJob("generic");
    job.role = "Software Engineer";

    const result = await persistAnalyzedJobs([{ job, jd: usaJd, cost: 0.002 }]);

    expect(result.count).toBe(1);
    expect(dataMocks.saveJob).toHaveBeenCalledWith([
      expect.objectContaining({ link: job.link, role: job.role, jd: usaJd }),
    ]);
  });
});
