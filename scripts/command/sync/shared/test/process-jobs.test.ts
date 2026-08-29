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
}));

const getJDMock = vi.hoisted(() => vi.fn());
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

vi.mock("@/modules/job-discovery/company", () => ({
  buildCompanyList: buildCompanyListMock,
}));

vi.mock("@/utils/logger", () => ({
  logger: loggerMocks,
}));

import { processJobs } from "../index";

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
    role: "Software Engineer",
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
    getJDMock.mockReset();
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
  });
});
