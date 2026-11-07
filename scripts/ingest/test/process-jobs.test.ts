import { beforeEach, describe, expect, it, vi } from "vitest";

import { JobCategory } from "@/constants/job-category";

import type * as PostingTitles from "@/modules/posting/screening";
import type { Job } from "@/types";
import type { JD } from "@/types/jobs";

import { HttpStatusCode, JD_FETCH_ERROR, JD_FETCH_OK } from "@/modules/posting/jd";
import { Posting } from "@/modules/posting/posting";

const dataMocks = vi.hoisted(() => ({
  urls: {
    load: vi.fn().mockResolvedValue(new Set<string>()),
    save: vi.fn().mockResolvedValue(undefined),
  },
  jobs: {
    load: vi.fn().mockResolvedValue([]),
    loadInFileOrder: vi.fn().mockResolvedValue([]),
    append: vi.fn().mockResolvedValue(undefined),
    replace: vi.fn().mockResolvedValue(undefined),
  },
  opportunities: {
    load: vi.fn().mockResolvedValue([]),
    append: vi.fn().mockResolvedValue(undefined),
    replace: vi.fn().mockResolvedValue(undefined),
  },
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

vi.mock("@/store", () => dataMocks);

vi.mock("@/modules/posting/batch", () => ({
  enqueueBatchJobs: enqueueBatchJobsMock,
}));

vi.mock("@/modules/posting/screening", async (importOriginal) => {
  const actual = await importOriginal<typeof PostingTitles>();
  return {
    ...actual,
    shouldBatchAnalyze: shouldBatchAnalyzeMock,
  };
});

vi.mock("@/modules/employer/build", () => ({
  buildCompanyList: buildCompanyListMock,
}));

vi.mock("@/utils/logger", () => ({
  logger: loggerMocks,
}));

import { persistAnalyzedJobs, processJobs } from "../index";

const analyzePostingSpy = vi.spyOn(Posting.prototype, "analyze");

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
    dataMocks.opportunities.load.mockReset().mockResolvedValue([]);
    dataMocks.opportunities.append.mockReset().mockResolvedValue(undefined);
    dataMocks.opportunities.replace.mockReset().mockResolvedValue(undefined);
    dataMocks.jobs.append.mockReset().mockResolvedValue(undefined);
    dataMocks.jobs.replace.mockReset().mockResolvedValue(undefined);
    dataMocks.urls.save.mockReset().mockResolvedValue(undefined);
    dataMocks.urls.load.mockReset().mockResolvedValue(new Set<string>());
    dataMocks.jobs.load.mockReset().mockResolvedValue([]);
    dataMocks.jobs.loadInFileOrder.mockReset().mockResolvedValue([]);
    getJDMock.mockReset();
    analyzePostingSpy.mockImplementation(async function (this: Posting) {
      const result = await getJDMock(this);
      this.jd = result.jd;
      return result;
    });
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
    expect(dataMocks.jobs.append).toHaveBeenCalledWith([
      expect.objectContaining({ link: job.link, jd: usaJd, id: 1 }),
    ]);
    expect(dataMocks.opportunities.append).toHaveBeenCalledWith([
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
    expect(dataMocks.jobs.append).toHaveBeenCalledWith([]);
    expect(dataMocks.opportunities.append).not.toHaveBeenCalled();
    expect(dataMocks.urls.save).toHaveBeenCalledWith(new Set());
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
    expect(dataMocks.opportunities.append).not.toHaveBeenCalled();
    expect(dataMocks.jobs.append).toHaveBeenCalledWith([]);
    expect(loggerMocks.error).toHaveBeenCalledTimes(2);
  });

  it("still records location-filtered jobs without a JD so they are not retried", async () => {
    const job = makeJob("singapore");
    job.location = "Singapore";
    job.country = "Singapore";

    const result = await processJobs({
      jobs: [job],
      ...emptyContext(),
      filter: () => true,
    });

    expect(getJDMock).not.toHaveBeenCalled();
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(dataMocks.opportunities.append).toHaveBeenCalledWith([
      expect.objectContaining({
        link: job.link,
        location: "Singapore",
        country: "Singapore",
        expired: false,
      }),
    ]);
    expect(dataMocks.opportunities.append.mock.calls[0]?.[0]?.[0]).not.toHaveProperty("jd");
    expect(dataMocks.jobs.append).toHaveBeenCalledWith([]);
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
    expect(dataMocks.jobs.append).toHaveBeenCalledWith([]);
    expect(dataMocks.opportunities.append).toHaveBeenCalledWith([
      expect.objectContaining({ link: job.link, expired: false }),
    ]);
  });

  it("writes batch-analyzed jobs onto existing opportunities and notifies when eligible", async () => {
    const job = makeJob("batch-1");
    dataMocks.opportunities.load.mockResolvedValue([
      {
        ...job,
        postedAt: "2026-01-01T00:00:00.000Z",
        expired: false,
      },
    ]);
    dataMocks.jobs.load.mockResolvedValue([{ id: 7 }]);

    const result = await persistAnalyzedJobs([{ job, jd: usaJd, cost: 0.002 }]);

    expect(result.count).toBe(1);
    expect(result.jobs[0]).toMatchObject({ id: 8, jd: usaJd });
    expect(loggerMocks.info).toHaveBeenCalledWith(
      {
        company: job.company,
        role: job.role,
        url: job.link,
      },
      "✅ Job matches notification criteria"
    );
    expect(dataMocks.jobs.append).toHaveBeenCalledWith([
      expect.objectContaining({ link: job.link, jd: usaJd, id: 8 }),
    ]);
    expect(dataMocks.opportunities.replace).toHaveBeenCalledWith([
      expect.objectContaining({
        link: job.link,
        jd: usaJd,
        postedAt: "2026-01-01T00:00:00.000Z",
      }),
    ]);
  });

  it("saves non-notify titles without emailing", async () => {
    const job = makeJob("senior");
    job.role = "Senior Software Engineer";

    const result = await persistAnalyzedJobs([{ job, jd: usaJd, cost: 0.002 }]);

    expect(result.count).toBe(0);
    expect(dataMocks.jobs.append).toHaveBeenCalledWith([]);
    expect(dataMocks.opportunities.append).toHaveBeenCalledWith([
      expect.objectContaining({ link: job.link, jd: usaJd, role: job.role }),
    ]);
  });

  it("stores trimmed company and role from a real-time analysis without changing the input", async () => {
    const job = {
      ...makeJob("padded"),
      company: " Point 72 ",
      role: " Junior  Software Engineer\t",
    };
    const snapshot = structuredClone(job);
    getJDMock.mockResolvedValue({ jd: usaJd, rawJD: "raw", cost: 0.01, error: JD_FETCH_OK });

    await processJobs({ jobs: [job], ...emptyContext() });

    const trimmed = { company: "Point 72", role: "Junior  Software Engineer" };
    expect(dataMocks.jobs.append).toHaveBeenCalledWith([expect.objectContaining(trimmed)]);
    expect(dataMocks.opportunities.append).toHaveBeenCalledWith([expect.objectContaining(trimmed)]);
    expect(job).toEqual(snapshot);
  });

  it("queues and stores trimmed company and role on the batch path", async () => {
    shouldBatchAnalyzeMock.mockReturnValue(true);
    const queued = {
      ...makeJob("padded-batch"),
      company: " Point 72 ",
      role: " Senior  Engineer ",
    };

    await processJobs({ jobs: [queued], ...emptyContext() });

    const trimmed = { company: "Point 72", role: "Senior  Engineer" };
    expect(enqueueBatchJobsMock).toHaveBeenCalledWith([expect.objectContaining(trimmed)]);
    expect(dataMocks.opportunities.append).toHaveBeenCalledWith([expect.objectContaining(trimmed)]);

    const analyzed = {
      ...makeJob("padded-collect"),
      company: "  Acme ",
      role: " Junior Software Engineer ",
    };
    const snapshot = structuredClone(analyzed);

    await persistAnalyzedJobs([{ job: analyzed, jd: usaJd, cost: 0.002 }]);

    expect(dataMocks.jobs.append).toHaveBeenLastCalledWith([
      expect.objectContaining({ company: "Acme", role: "Junior Software Engineer", jd: usaJd }),
    ]);
    expect(analyzed).toEqual(snapshot);
  });

  it("does not copy a legacy stored JD onto the opportunity of a re-analyzed job", async () => {
    // Thomson Reuters JREQ199695: stored in May 2026, posted again under a new URL.
    const stored = {
      company: "Thomsonreuters",
      role: "Automation and AI Solutions Lead",
      link: "https://thomsonreuters.wd5.myworkdayjobs.com/external_career_site/job/India-Bengaluru-Karnataka/Automation-and-AI-Solutions-Lead_JREQ199695",
      location: "",
      id: 1200,
      jd: {
        citizenship: false,
        sponsorship: null,
        location: "Other",
        qualifications: ["Have 5-8 years total experience."],
        season: "Senior Level",
      },
    } as unknown as Job;
    const reposted = {
      ...stored,
      link: "https://thomsonreuters.wd5.myworkdayjobs.com/external_career_site/job/India-Hyderabad/Automation-and-AI-Solutions-Lead_JREQ199695",
      jd: undefined,
      id: undefined,
    };
    const seniorJd: JD = { ...usaJd, country: "India", category: JobCategory.SENIOR_LEVEL };
    dataMocks.jobs.loadInFileOrder.mockResolvedValue([stored]);

    const result = await persistAnalyzedJobs([{ job: reposted, jd: seniorJd, cost: 0.002 }]);

    expect(result.count).toBe(0);
    expect(dataMocks.jobs.append).toHaveBeenCalledWith([]);
    expect(dataMocks.opportunities.append).toHaveBeenCalledWith([
      expect.objectContaining({ id: 1200, jd: seniorJd }),
    ]);
  });

  it("keeps a current stored JD from an earlier season on the opportunity", async () => {
    const storedJd: JD = {
      ...usaJd,
      category: JobCategory.SUMMER_INTERN,
      season: "2025 Summer" as JD["season"],
    };
    const stored = { ...makeJob("stored"), id: 3, jd: storedJd };
    dataMocks.jobs.loadInFileOrder.mockResolvedValue([stored]);

    await persistAnalyzedJobs([{ job: makeJob("stored"), jd: usaJd, cost: 0.002 }]);

    expect(dataMocks.opportunities.append).toHaveBeenCalledWith([
      expect.objectContaining({ id: 3, jd: storedJd }),
    ]);
  });

  it("writes a stored non-intern JD with its season normalized to None", async () => {
    const storedJd = { ...usaJd, location: "Stored HQ", season: "2025 Summer" as JD["season"] };
    const stored = { ...makeJob("stored-entry"), id: 4, jd: storedJd };
    dataMocks.jobs.loadInFileOrder.mockResolvedValue([stored]);

    await persistAnalyzedJobs([{ job: makeJob("stored-entry"), jd: usaJd, cost: 0.002 }]);

    expect(dataMocks.opportunities.append).toHaveBeenCalledWith([
      expect.objectContaining({ id: 4, jd: { ...storedJd, season: "None" } }),
    ]);
    expect(storedJd.season).toBe("2025 Summer");
  });

  it("uses the new JD when the stored intern season conflicts with its category", async () => {
    const storedJd: JD = {
      ...usaJd,
      location: "Stored HQ",
      category: JobCategory.SUMMER_INTERN,
      season: "2025 Fall" as JD["season"],
    };
    const stored = { ...makeJob("stored-intern"), id: 5, jd: storedJd };
    dataMocks.jobs.loadInFileOrder.mockResolvedValue([stored]);

    await persistAnalyzedJobs([{ job: makeJob("stored-intern"), jd: usaJd, cost: 0.002 }]);

    expect(dataMocks.opportunities.append).toHaveBeenCalledWith([
      expect.objectContaining({ id: 5, jd: usaJd }),
    ]);
  });

  it("notifies unspecified-level titles when the JD matches config", async () => {
    const job = makeJob("generic");
    job.role = "Software Engineer";

    const result = await persistAnalyzedJobs([{ job, jd: usaJd, cost: 0.002 }]);

    expect(result.count).toBe(1);
    expect(dataMocks.jobs.append).toHaveBeenCalledWith([
      expect.objectContaining({ link: job.link, role: job.role, jd: usaJd }),
    ]);
  });
});
