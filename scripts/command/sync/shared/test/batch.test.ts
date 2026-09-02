import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Job } from "@/types";
import type { JD } from "@/types/jobs";

import { JobCategory } from "@/validation/config";

const collectInflightBatchesMock = vi.hoisted(() => vi.fn());
const loadBatchQueueMock = vi.hoisted(() => vi.fn());
const loadInflightBatchesMock = vi.hoisted(() => vi.fn());
const submitQueuedJobsMock = vi.hoisted(() => vi.fn());
const persistAnalyzedJobsMock = vi.hoisted(() => vi.fn());

vi.mock("@/modules/job-analysis/batch-queue", () => ({
  collectInflightBatches: collectInflightBatchesMock,
  loadBatchQueue: loadBatchQueueMock,
  loadInflightBatches: loadInflightBatchesMock,
  submitQueuedJobs: submitQueuedJobsMock,
}));

vi.mock("../index", () => ({
  persistAnalyzedJobs: persistAnalyzedJobsMock,
}));

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import processBatchQueue from "../batch";

const usaJd: JD = {
  citizenship: false,
  sponsorship: true,
  qualifications: ["Bachelor's degree"],
  country: "USA",
  location: "Austin, TX",
  category: JobCategory.ENTRY_LEVEL,
  season: "None",
};

function makeJob(): Job {
  return {
    company: "Acme",
    role: "Software Engineer",
    link: "https://job-boards.greenhouse.io/acme/jobs/99",
    location: "Austin, TX",
  };
}

const emptyPersist = {
  jobs: [],
  count: 0,
  skipped: 0,
  totalCost: 0,
};

describe("processBatchQueue", () => {
  beforeEach(() => {
    collectInflightBatchesMock.mockReset();
    loadBatchQueueMock.mockReset().mockResolvedValue([]);
    loadInflightBatchesMock.mockReset().mockResolvedValue([]);
    submitQueuedJobsMock.mockReset();
    persistAnalyzedJobsMock.mockReset().mockResolvedValue(emptyPersist);
  });

  it("persists collected results even when there is no time left to submit", async () => {
    const analyzed = [{ job: makeJob(), jd: usaJd, cost: 0.002 }];
    collectInflightBatchesMock.mockResolvedValue({
      analyzed,
      remaining: [],
      completedDurationMs: 240_000,
    });
    persistAnalyzedJobsMock.mockResolvedValue({
      jobs: analyzed.map(({ job, jd }) => ({ ...job, jd })),
      count: 1,
      skipped: 0,
      totalCost: 0.002,
    });

    const result = await processBatchQueue(0);

    expect(persistAnalyzedJobsMock).toHaveBeenCalledWith(analyzed);
    expect(submitQueuedJobsMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      collected: 1,
      submitted: 0,
      notified: 1,
      totalCost: 0.002,
    });
  });

  it("submits queued jobs after collecting inflight results", async () => {
    collectInflightBatchesMock.mockResolvedValue({ analyzed: [], remaining: [] });
    loadBatchQueueMock.mockResolvedValueOnce([makeJob()]).mockResolvedValue([]);
    submitQueuedJobsMock.mockResolvedValue({ submitted: 1, analyzed: [] });

    const result = await processBatchQueue();

    expect(submitQueuedJobsMock).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      collected: 0,
      submitted: 1,
      notified: 0,
      totalCost: 0,
    });
  });

  it("persists real-time fallback analysis from submit", async () => {
    const analyzed = [{ job: makeJob(), jd: usaJd, cost: 0.01 }];
    collectInflightBatchesMock.mockResolvedValue({ analyzed: [], remaining: [] });
    persistAnalyzedJobsMock
      .mockResolvedValueOnce(emptyPersist)
      .mockResolvedValueOnce({
        jobs: analyzed.map(({ job, jd }) => ({ ...job, jd })),
        count: 1,
        skipped: 0,
        totalCost: 0.01,
      });
    loadBatchQueueMock.mockResolvedValueOnce([makeJob()]).mockResolvedValue([]);
    submitQueuedJobsMock.mockResolvedValue({ submitted: 0, analyzed });

    const result = await processBatchQueue();

    expect(persistAnalyzedJobsMock).toHaveBeenNthCalledWith(2, analyzed);
    expect(result).toMatchObject({
      collected: 0,
      submitted: 0,
      notified: 1,
      totalCost: 0.01,
    });
  });

  it("polls inflight batches until Gemini finishes, then persists the results", async () => {
    const analyzed = [{ job: makeJob(), jd: usaJd, cost: 0.002 }];
    const sleep = vi.fn().mockResolvedValue(undefined);
    collectInflightBatchesMock
      .mockResolvedValueOnce({ analyzed: [], remaining: [] })
      .mockResolvedValueOnce({ analyzed, remaining: [], completedDurationMs: 240_000 });
    persistAnalyzedJobsMock
      .mockResolvedValueOnce(emptyPersist)
      .mockResolvedValueOnce({
        jobs: analyzed.map(({ job, jd }) => ({ ...job, jd })),
        count: 1,
        skipped: 0,
        totalCost: 0.002,
      });
    loadBatchQueueMock.mockResolvedValueOnce([makeJob()]).mockResolvedValue([]);
    submitQueuedJobsMock.mockResolvedValue({ submitted: 1, analyzed: [] });
    loadInflightBatchesMock
      .mockResolvedValueOnce([{ name: "batches/abc", submittedAt: "2026-09-02T00:00:00.000Z", jobs: [makeJob()] }])
      .mockResolvedValue([]);

    const result = await processBatchQueue(120_000, { pollIntervalMs: 1, sleep });

    expect(sleep).toHaveBeenCalledOnce();
    expect(collectInflightBatchesMock).toHaveBeenCalledTimes(2);
    expect(persistAnalyzedJobsMock).toHaveBeenNthCalledWith(2, analyzed);
    expect(result).toMatchObject({
      collected: 1,
      submitted: 1,
      notified: 1,
      totalCost: 0.002,
      inflight: 0,
    });
  });
});
