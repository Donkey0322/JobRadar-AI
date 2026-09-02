import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Job } from "@/types";
import type { JD } from "@/types/jobs";

import { HttpStatusCode, JD_FETCH_ERROR, JD_FETCH_OK } from "@/modules/ats/detail";
import { JobCategory } from "@/validation/config";

const readNdjsonFileIfExistsMock = vi.hoisted(() => vi.fn());
const readJsonFileMock = vi.hoisted(() => vi.fn());
const writeFileMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mkdirMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const getAIProviderMock = vi.hoisted(() => vi.fn());
const getRawJDMock = vi.hoisted(() => vi.fn());
const analyzeJDMock = vi.hoisted(() => vi.fn());
const getAnalyzeJDConfigMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ schema: { type: "object" }, systemInstruction: "sys" })
);

vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal()) as {
    promises: Record<string, unknown>;
    [key: string]: unknown;
  };
  return {
    ...actual,
    promises: {
      ...actual.promises,
      writeFile: writeFileMock,
      mkdir: mkdirMock,
    },
  };
});

vi.mock("@/utils/ndjson-archive", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    readNdjsonFileIfExists: readNdjsonFileIfExistsMock,
  };
});

vi.mock("@/utils/data", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    readJsonFile: readJsonFileMock,
  };
});

vi.mock("@/utils/ai", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getAIProvider: getAIProviderMock,
  };
});

vi.mock("@/modules/job-analysis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/job-analysis")>();
  return {
    ...actual,
    getRawJD: getRawJDMock,
  };
});

vi.mock("../ai", () => ({
  default: analyzeJDMock,
  formatJDPrompt: (rawJD: string) => rawJD,
  getAnalyzeJDConfig: getAnalyzeJDConfigMock,
}));

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { collectInflightBatches, enqueueBatchJobs, submitQueuedJobs } from "../batch-queue";

import { getJobKey } from "@/utils/job-key";

const usaJd: JD = {
  citizenship: false,
  sponsorship: true,
  qualifications: ["Bachelor's degree"],
  country: "USA",
  location: "Austin, TX",
  category: JobCategory.SENIOR_LEVEL,
  season: "None",
};

function makeJob(): Job {
  return {
    company: "Acme",
    role: "Senior Software Engineer",
    link: "https://job-boards.greenhouse.io/acme/jobs/99",
    location: "Austin, TX",
  };
}

describe("batch-queue", () => {
  beforeEach(() => {
    readNdjsonFileIfExistsMock.mockReset().mockResolvedValue([]);
    readJsonFileMock.mockReset().mockResolvedValue([]);
    writeFileMock.mockReset().mockResolvedValue(undefined);
    mkdirMock.mockReset().mockResolvedValue(undefined);
    getAIProviderMock.mockReset();
    getRawJDMock.mockReset();
    analyzeJDMock.mockReset();
    getAnalyzeJDConfigMock.mockReset().mockResolvedValue({
      schema: { type: "object" },
      systemInstruction: "sys",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("appends unseen jobs to the batch queue", async () => {
    const job = makeJob();

    await enqueueBatchJobs([job, job]);

    expect(writeFileMock).toHaveBeenCalledWith(
      expect.stringContaining(`${path.sep}batch${path.sep}queue.ndjson`),
      `${JSON.stringify({
        company: job.company,
        role: job.role,
        link: job.link,
        location: job.location,
      })}\n`,
      "utf-8"
    );
  });

  it("collects succeeded batch results and maps them back to jobs", async () => {
    const job = makeJob();
    readJsonFileMock.mockResolvedValue([
      {
        name: "batches/abc",
        submittedAt: "2026-09-01T00:00:00.000Z",
        jobs: [job],
      },
    ]);
    getAIProviderMock.mockReturnValue({
      getBatch: vi.fn().mockResolvedValue({
        state: "succeeded",
        durationMs: 240_000,
        results: [
          {
            key: getJobKey(job.link),
            result: JSON.stringify(usaJd),
            cost: 0.001,
          },
        ],
      }),
    });

    const { analyzed, remaining, completedDurationMs } = await collectInflightBatches();

    expect(remaining).toEqual([]);
    expect(completedDurationMs).toBe(240_000);
    expect(analyzed).toEqual([
      expect.objectContaining({
        job,
        jd: usaJd,
        cost: 0.001,
      }),
    ]);
    expect(writeFileMock).toHaveBeenCalledWith(
      expect.stringContaining(`${path.sep}batch${path.sep}inflight.json`),
      `${JSON.stringify([], null, 2)}\n`,
      "utf-8"
    );
  });

  it("re-queues jobs whose succeeded batch result is empty or unparseable", async () => {
    const job = makeJob();
    readJsonFileMock.mockResolvedValue([
      {
        name: "batches/abc",
        submittedAt: "2026-09-01T00:00:00.000Z",
        jobs: [job],
      },
    ]);
    getAIProviderMock.mockReturnValue({
      getBatch: vi.fn().mockResolvedValue({
        state: "succeeded",
        durationMs: 240_000,
        results: [
          {
            key: getJobKey(job.link),
            result: null,
            cost: 0,
          },
        ],
      }),
    });

    const { analyzed, remaining } = await collectInflightBatches();

    expect(analyzed).toEqual([]);
    expect(remaining).toEqual([]);
    expect(writeFileMock).toHaveBeenCalledWith(
      expect.stringContaining(`${path.sep}batch${path.sep}queue.ndjson`),
      `${JSON.stringify({
        company: job.company,
        role: job.role,
        link: job.link,
        location: job.location,
      })}\n`,
      "utf-8"
    );
  });

  it("leaves the queue untouched when AI_MODE is DOWN", async () => {
    vi.stubEnv("AI_MODE", "DOWN");
    readNdjsonFileIfExistsMock.mockResolvedValue([makeJob()]);

    const result = await submitQueuedJobs();

    expect(result).toEqual({ submitted: 0, analyzed: [] });
    expect(getRawJDMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("submits fetched jobs to the batch API and records them as inflight", async () => {
    const job = makeJob();
    readNdjsonFileIfExistsMock.mockResolvedValue([job]);
    getRawJDMock.mockResolvedValue({ jd: "raw jd", error: JD_FETCH_OK });
    const submitBatch = vi.fn().mockResolvedValue({ name: "batches/xyz" });
    getAIProviderMock.mockReturnValue({
      submitBatch,
      getBatch: vi.fn(),
    });

    const result = await submitQueuedJobs();

    expect(result).toEqual({ submitted: 1, analyzed: [] });
    expect(submitBatch).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          key: getJobKey(job.link),
          prompt: "raw jd",
        }),
      ],
      expect.any(String)
    );
    expect(writeFileMock).toHaveBeenCalledWith(
      expect.stringContaining(`${path.sep}batch${path.sep}inflight.json`),
      expect.stringContaining("batches/xyz"),
      "utf-8"
    );
    expect(writeFileMock).toHaveBeenCalledWith(
      expect.stringContaining(`${path.sep}batch${path.sep}queue.ndjson`),
      "",
      "utf-8"
    );
  });

  it("falls back to real-time analysis when the provider has no Batch API", async () => {
    const job = makeJob();
    readNdjsonFileIfExistsMock.mockResolvedValue([job]);
    getRawJDMock.mockResolvedValue({ jd: "raw jd", error: JD_FETCH_OK });
    getAIProviderMock.mockReturnValue({});
    analyzeJDMock.mockResolvedValue({ result: JSON.stringify(usaJd), cost: 0.01 });

    const result = await submitQueuedJobs();

    expect(result.submitted).toBe(0);
    expect(result.analyzed).toEqual([
      expect.objectContaining({
        job,
        jd: usaJd,
        cost: 0.01,
      }),
    ]);
  });

  it("keeps retryable JD fetch failures in the queue and drops the rest", async () => {
    const retryJob = makeJob();
    const dropJob = {
      ...makeJob(),
      link: "https://job-boards.greenhouse.io/acme/jobs/100",
    };
    readNdjsonFileIfExistsMock.mockResolvedValue([retryJob, dropJob]);
    getRawJDMock.mockImplementation(async (url: string) => {
      if (url === retryJob.link) {
        return { jd: null, error: JD_FETCH_ERROR.fetch("socket hang up") };
      }

      return {
        jd: null,
        error: JD_FETCH_ERROR.http(HttpStatusCode.NOT_FOUND, "Not Found"),
      };
    });
    getAIProviderMock.mockReturnValue({
      submitBatch: vi.fn(),
      getBatch: vi.fn(),
    });

    const result = await submitQueuedJobs();

    expect(result).toEqual({ submitted: 0, analyzed: [] });
    expect(writeFileMock).toHaveBeenCalledWith(
      expect.stringContaining(`${path.sep}batch${path.sep}queue.ndjson`),
      `${JSON.stringify({
        company: retryJob.company,
        role: retryJob.role,
        link: retryJob.link,
        location: retryJob.location,
      })}\n`,
      "utf-8"
    );
  });
});
