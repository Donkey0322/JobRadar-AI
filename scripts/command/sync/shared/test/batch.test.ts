import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Job } from "@/types";
import type { JD } from "@/types/jobs";

import { JobCategory } from "@/validation/config";

const collectInflightBatchesMock = vi.hoisted(() => vi.fn());
const loadBatchQueueMock = vi.hoisted(() => vi.fn());
const loadInflightBatchesMock = vi.hoisted(() => vi.fn());
const submitQueuedJobsMock = vi.hoisted(() => vi.fn());
const persistAnalyzedJobsMock = vi.hoisted(() => vi.fn());
const loadBatchScheduleMock = vi.hoisted(() => vi.fn());
const saveBatchScheduleMock = vi.hoisted(() => vi.fn());

vi.mock("@/modules/job-analysis/batch-queue", () => ({
  collectInflightBatches: collectInflightBatchesMock,
  loadBatchQueue: loadBatchQueueMock,
  loadInflightBatches: loadInflightBatchesMock,
  submitQueuedJobs: submitQueuedJobsMock,
}));

vi.mock("@/modules/job-analysis/batch-schedule", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/job-analysis/batch-schedule")>();
  return {
    ...actual,
    loadBatchSchedule: loadBatchScheduleMock,
    saveBatchSchedule: saveBatchScheduleMock,
  };
});

vi.mock("../index", () => ({
  persistAnalyzedJobs: persistAnalyzedJobsMock,
}));

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { defaultBatchSchedule } from "@/modules/job-analysis/batch-schedule";

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

describe("processBatchQueue", () => {
  beforeEach(() => {
    collectInflightBatchesMock.mockReset();
    loadBatchQueueMock.mockReset().mockResolvedValue([]);
    loadInflightBatchesMock.mockReset().mockResolvedValue([]);
    submitQueuedJobsMock.mockReset();
    persistAnalyzedJobsMock.mockReset();
    loadBatchScheduleMock.mockReset().mockResolvedValue(defaultBatchSchedule());
    saveBatchScheduleMock.mockReset().mockResolvedValue(undefined);
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
      skippedDue: false,
    });
    expect(saveBatchScheduleMock).toHaveBeenCalled();
  });

  it("submits queued jobs after collecting inflight results", async () => {
    collectInflightBatchesMock.mockResolvedValue({ analyzed: [], remaining: [] });
    persistAnalyzedJobsMock.mockResolvedValue({
      jobs: [],
      count: 0,
      skipped: 0,
      totalCost: 0,
    });
    loadBatchQueueMock.mockResolvedValueOnce([makeJob()]).mockResolvedValue([]);
    submitQueuedJobsMock.mockResolvedValue({ submitted: 1, analyzed: [] });

    const result = await processBatchQueue();

    expect(submitQueuedJobsMock).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      collected: 0,
      submitted: 1,
      notified: 0,
      totalCost: 0,
      skippedDue: false,
    });
  });

  it("persists real-time fallback analysis from submit", async () => {
    const analyzed = [{ job: makeJob(), jd: usaJd, cost: 0.01 }];
    collectInflightBatchesMock.mockResolvedValue({ analyzed: [], remaining: [] });
    persistAnalyzedJobsMock
      .mockResolvedValueOnce({
        jobs: [],
        count: 0,
        skipped: 0,
        totalCost: 0,
      })
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
      skippedDue: false,
    });
  });

  it("skips collect and submit when --if-due and the next check is in the future", async () => {
    loadBatchScheduleMock.mockResolvedValue({
      intervalMs: 5 * 60 * 1000,
      nextCheckAt: "2099-01-01T00:00:00.000Z",
      lastDurationMs: 240_000,
    });

    const result = await processBatchQueue(undefined, { ifDue: true });

    expect(result.skippedDue).toBe(true);
    expect(collectInflightBatchesMock).not.toHaveBeenCalled();
    expect(submitQueuedJobsMock).not.toHaveBeenCalled();
    expect(saveBatchScheduleMock).not.toHaveBeenCalled();
  });
});
