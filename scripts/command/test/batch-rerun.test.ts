import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as StorePaths from "@/store/paths";
import type { Job, Opportunity } from "@/types";
import type { JD } from "@/types/jobs";
import type * as AI from "@/utils/ai";

const paths = await vi.hoisted(async () => {
  const nodeOs = await import("node:os");
  const nodePath = await import("node:path");
  const { mkdtemp } = await import("node:fs/promises");
  const root = await mkdtemp(nodePath.join(nodeOs.tmpdir(), "jobradar-batch-rerun-"));

  return { root };
});

const provider = vi.hoisted(() => {
  const batches = new Map<
    string,
    | { state: "succeeded"; durationMs: number; results: Array<{ key: string; result: string; cost: number }> }
    | { state: "failed"; error: string }
  >();

  return {
    batches,
    generate: vi.fn(),
    submitBatch: vi.fn(),
    getBatch: vi.fn(async (name: string) => {
      const status = batches.get(name);
      if (!status) throw new Error(`Unknown batch ${name}`);
      return status;
    }),
  };
});

vi.mock("@/store/paths", async () => {
  const nodePath = await import("node:path");
  const data = () => nodePath.join(paths.root, "data");

  return {
    get DATA_PATH() {
      return data();
    },
    get URLS_PATH() {
      return nodePath.join(data(), "urls.json");
    },
    get JOB_PATH() {
      return nodePath.join(data(), "jobs.ndjson");
    },
    get OPPORTUNITIES_PATH() {
      return nodePath.join(data(), "opportunities.ndjson");
    },
    get ARCHIVE_PATH() {
      return nodePath.join(data(), "archive");
    },
    get COMPANY_PATH() {
      return nodePath.join(data(), "company.json");
    },
    get ERROR_LOG_PATH() {
      return nodePath.join(data(), "discover-errors.log");
    },
    get BATCH_PATH() {
      return nodePath.join(data(), "batch");
    },
    get BATCH_QUEUE_PATH() {
      return nodePath.join(data(), "batch", "queue.ndjson");
    },
    get BATCH_INFLIGHT_PATH() {
      return nodePath.join(data(), "batch", "inflight.json");
    },
    JOB_ARCHIVE_CHUNK: 1000,
    OPPORTUNITY_ARCHIVE_CHUNK: 5000,
  } satisfies Partial<typeof StorePaths> & Record<string, unknown>;
});

vi.mock("@/utils/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof AI>();
  return {
    ...actual,
    getAIProvider: () => ({
      generate: provider.generate,
      validateModel: vi.fn(),
      submitBatch: provider.submitBatch,
      getBatch: provider.getBatch,
    }),
  };
});

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { JobCategory } from "@/constants/job-category";

import { processBatchQueue } from "../batch";

import { getJobKey } from "@/modules/ats/job-key";
import {
  collectInflightBatches,
  loadBatchQueue,
  loadInflightBatches,
  saveInflightBatches,
} from "@/modules/posting/batch";
import { JD_FETCH_OK } from "@/modules/posting/jd";
import { Posting } from "@/modules/posting/posting";
import * as store from "@/store";
import { BATCH_INFLIGHT_PATH, JOB_PATH, OPPORTUNITIES_PATH } from "@/store/paths";
import { logger } from "@/utils/logger";

const fetchMock = vi.fn<typeof fetch>();

function jd(location: string): JD {
  return {
    citizenship: false,
    sponsorship: true,
    qualifications: ["Bachelor's degree"],
    country: "USA",
    location,
    category: JobCategory.SUMMER_INTERN,
    season: "None",
  };
}

function job(company: string, id: string): Job {
  return {
    company,
    role: "Software Engineer Intern",
    link: `https://job-boards.greenhouse.io/${company.toLowerCase()}/jobs/${id}`,
    location: "Austin, TX",
  };
}

const alpha = job("Alpha", "101");
const beta = job("Beta", "202");

async function readNdjson<T>(file: string): Promise<T[]> {
  try {
    const text = await fs.readFile(file, "utf-8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function storedJob(source: Job, id: number, location: string) {
  return {
    id,
    company: source.company,
    role: source.role,
    link: source.link,
    location: source.location,
    jd: jd(location),
  };
}

describe("batch rerun baseline", () => {
  const dirs: string[] = [];

  beforeEach(async () => {
    paths.root = await fs.mkdtemp(path.join(os.tmpdir(), "jobradar-batch-rerun-"));
    dirs.push(paths.root);
    provider.batches.clear();
    provider.generate.mockReset();
    provider.submitBatch.mockReset();
    provider.getBatch.mockClear();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => {
      throw new Error("batch rerun baseline must not use the network");
    });
    vi.stubGlobal("fetch", fetchMock);
    process.env.AI_API_KEY = "test-fake-ai-key";

    expect(JOB_PATH.startsWith(paths.root)).toBe(true);
    expect(path.relative(process.cwd(), JOB_PATH).startsWith("..")).toBe(true);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it("writes each completed inflight result once, and a rerun of that saved state adds nothing", async () => {
    provider.batches.set("batches/done", {
      state: "succeeded",
      durationMs: 240_000,
      results: [
        { key: getJobKey(alpha.link), result: JSON.stringify(jd("Alpha HQ")), cost: 0.001 },
        { key: getJobKey(beta.link), result: JSON.stringify(jd("Beta HQ")), cost: 0.002 },
      ],
    });
    await saveInflightBatches([
      {
        name: "batches/done",
        submittedAt: "2026-09-01T00:00:00.000Z",
        phase: "screen",
        jobs: [alpha, beta],
      },
    ]);

    const first = await processBatchQueue(0);

    expect(first).toMatchObject({ collected: 2, notified: 2, totalCost: 0.003, inflight: 0 });
    expect(await loadInflightBatches()).toEqual([]);
    expect(await loadBatchQueue()).toEqual([]);
    expect(await readNdjson<Job>(JOB_PATH)).toEqual([
      storedJob(alpha, 1, "Alpha HQ"),
      storedJob(beta, 2, "Beta HQ"),
    ]);
    const opportunities = await readNdjson<Opportunity>(OPPORTUNITIES_PATH);
    expect(opportunities.map(({ postedAt: _postedAt, ...row }) => row)).toEqual([
      { ...storedJob(alpha, 1, "Alpha HQ"), expired: false },
      { ...storedJob(beta, 2, "Beta HQ"), expired: false },
    ]);
    expect(opportunities.map((row) => row.postedAt)).toEqual([
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    ]);

    const jobsAfterFirst = await fs.readFile(JOB_PATH, "utf-8");
    const opportunitiesAfterFirst = await fs.readFile(OPPORTUNITIES_PATH, "utf-8");

    const second = await processBatchQueue(0);

    expect(second).toMatchObject({ collected: 0, notified: 0, totalCost: 0, inflight: 0 });
    expect(await fs.readFile(JOB_PATH, "utf-8")).toBe(jobsAfterFirst);
    expect(await fs.readFile(OPPORTUNITIES_PATH, "utf-8")).toBe(opportunitiesAfterFirst);
    expect(await loadInflightBatches()).toEqual([]);
    expect(provider.generate).not.toHaveBeenCalled();
    expect(provider.submitBatch).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  async function saveDone(results: Array<{ key: string; result: string; cost: number }>) {
    provider.batches.set("batches/done", {
      state: "succeeded",
      durationMs: 240_000,
      results,
    });
    await saveInflightBatches([
      {
        name: "batches/done",
        submittedAt: "2026-09-01T00:00:00.000Z",
        phase: "screen",
        jobs: [alpha, beta],
      },
    ]);
  }

  it("keeps the inflight file when jobs fail to store, then the rerun writes both datasets once", async () => {
    await saveDone([
      { key: getJobKey(alpha.link), result: JSON.stringify(jd("Alpha HQ")), cost: 0.001 },
      { key: getJobKey(beta.link), result: JSON.stringify(jd("Beta HQ")), cost: 0.002 },
    ]);
    const inflightBefore = await fs.readFile(BATCH_INFLIGHT_PATH, "utf-8");
    const appendJobs = vi.spyOn(store.jobs, "append").mockImplementation(async () => {
      throw new Error("injected interrupt before jobs are stored");
    });

    await expect(processBatchQueue(0)).rejects.toThrow("injected interrupt before jobs are stored");

    expect(await fs.readFile(BATCH_INFLIGHT_PATH, "utf-8")).toBe(inflightBefore);
    expect(await loadInflightBatches()).toEqual([
      expect.objectContaining({ name: "batches/done", jobs: [alpha, beta] }),
    ]);
    expect(await readNdjson<Job>(JOB_PATH)).toEqual([]);
    expect(await readNdjson<Opportunity>(OPPORTUNITIES_PATH)).toEqual([]);
    appendJobs.mockRestore();

    const restart = await processBatchQueue(0);

    expect(restart).toMatchObject({ collected: 2, notified: 2, inflight: 0 });
    expect(await readNdjson<Job>(JOB_PATH)).toEqual([
      storedJob(alpha, 1, "Alpha HQ"),
      storedJob(beta, 2, "Beta HQ"),
    ]);
    const opportunities = await readNdjson<Opportunity>(OPPORTUNITIES_PATH);
    expect(opportunities.map(({ postedAt: _postedAt, ...row }) => row)).toEqual([
      { ...storedJob(alpha, 1, "Alpha HQ"), expired: false },
      { ...storedJob(beta, 2, "Beta HQ"), expired: false },
    ]);
    expect(new Set(opportunities.map((row) => row.id))).toEqual(new Set([1, 2]));

    const jobsAfter = await fs.readFile(JOB_PATH, "utf-8");
    const opportunitiesAfter = await fs.readFile(OPPORTUNITIES_PATH, "utf-8");
    const again = await processBatchQueue(0);

    expect(again).toMatchObject({ collected: 0, notified: 0, inflight: 0 });
    expect(await fs.readFile(JOB_PATH, "utf-8")).toBe(jobsAfter);
    expect(await fs.readFile(OPPORTUNITIES_PATH, "utf-8")).toBe(opportunitiesAfter);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the inflight file when opportunities fail after jobs are stored, then the rerun fills only opportunities", async () => {
    await saveDone([
      { key: getJobKey(alpha.link), result: JSON.stringify(jd("Alpha HQ")), cost: 0.001 },
      { key: getJobKey(beta.link), result: JSON.stringify(jd("Beta HQ")), cost: 0.002 },
    ]);
    const inflightBefore = await fs.readFile(BATCH_INFLIGHT_PATH, "utf-8");
    const appendOpportunities = vi
      .spyOn(store.opportunities, "append")
      .mockImplementation(async () => {
        throw new Error("injected interrupt after jobs are stored");
      });

    await expect(processBatchQueue(0)).rejects.toThrow(
      "injected interrupt after jobs are stored"
    );

    expect(await fs.readFile(BATCH_INFLIGHT_PATH, "utf-8")).toBe(inflightBefore);
    const jobsAfterFailure = await fs.readFile(JOB_PATH, "utf-8");
    expect(await readNdjson<Job>(JOB_PATH)).toEqual([
      storedJob(alpha, 1, "Alpha HQ"),
      storedJob(beta, 2, "Beta HQ"),
    ]);
    expect(await readNdjson<Opportunity>(OPPORTUNITIES_PATH)).toEqual([]);
    appendOpportunities.mockRestore();

    const restart = await processBatchQueue(0);

    expect(restart).toMatchObject({ collected: 2, inflight: 0 });
    expect(await fs.readFile(JOB_PATH, "utf-8")).toBe(jobsAfterFailure);
    const opportunities = await readNdjson<Opportunity>(OPPORTUNITIES_PATH);
    expect(opportunities.map(({ postedAt: _postedAt, ...row }) => row)).toEqual([
      { ...storedJob(alpha, 1, "Alpha HQ"), expired: false },
      { ...storedJob(beta, 2, "Beta HQ"), expired: false },
    ]);
    expect(opportunities.map((row) => row.id)).toEqual([1, 2]);

    const opportunitiesAfter = await fs.readFile(OPPORTUNITIES_PATH, "utf-8");
    const again = await processBatchQueue(0);

    expect(again).toMatchObject({ collected: 0, notified: 0, inflight: 0 });
    expect(await fs.readFile(JOB_PATH, "utf-8")).toBe(jobsAfterFailure);
    expect(await fs.readFile(OPPORTUNITIES_PATH, "utf-8")).toBe(opportunitiesAfter);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pairs results by key, including out-of-order keys", async () => {
    await saveDone([
      { key: getJobKey(beta.link), result: JSON.stringify(jd("Beta HQ")), cost: 0.002 },
      { key: getJobKey(alpha.link), result: JSON.stringify(jd("Alpha HQ")), cost: 0.001 },
    ]);

    const collected = await collectInflightBatches();

    expect(collected.analyzed).toEqual([
      { job: beta, jd: jd("Beta HQ"), cost: 0.002 },
      { job: alpha, jd: jd("Alpha HQ"), cost: 0.001 },
    ]);
    expect(await loadBatchQueue()).toEqual([]);
  });

  it("uses a key once when the provider repeats it and requeues the job that got nothing", async () => {
    vi.mocked(logger.warn).mockClear();
    await saveDone([
      { key: getJobKey(alpha.link), result: JSON.stringify(jd("Alpha first")), cost: 0.001 },
      { key: getJobKey(alpha.link), result: JSON.stringify(jd("Alpha duplicate")), cost: 0.009 },
    ]);

    const collected = await collectInflightBatches();

    expect(collected.analyzed).toEqual([
      { job: alpha, jd: jd("Alpha first"), cost: 0.001 },
    ]);
    expect(await loadBatchQueue()).toEqual([beta]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        key: getJobKey(alpha.link),
        reason: "duplicate key; job already paired",
      }),
      "⚠️ Batch result was not paired"
    );
  });

  it("does not give an index result to a job that was already paired by key", async () => {
    vi.mocked(logger.warn).mockClear();
    await saveDone([
      { key: getJobKey(beta.link), result: JSON.stringify(jd("Beta keyed")), cost: 0.002 },
      { key: "missing-batch-key", result: JSON.stringify(jd("Index slot 1")), cost: 0.004 },
    ]);

    const collected = await collectInflightBatches();

    expect(collected.analyzed).toEqual([{ job: beta, jd: jd("Beta keyed"), cost: 0.002 }]);
    expect(await loadBatchQueue()).toEqual([alpha]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 1,
        key: "missing-batch-key",
        reason: "index points at a job that already has a result",
      }),
      "⚠️ Batch result was not paired"
    );
  });

  it("uses the index when that job is still unpaired", async () => {
    await saveDone([
      { key: "missing-batch-key", result: JSON.stringify(jd("Index slot 0")), cost: 0.004 },
      { key: getJobKey(beta.link), result: JSON.stringify(jd("Beta keyed")), cost: 0.002 },
    ]);

    const collected = await collectInflightBatches();

    expect(collected.analyzed).toEqual([
      { job: alpha, jd: jd("Index slot 0"), cost: 0.004 },
      { job: beta, jd: jd("Beta keyed"), cost: 0.002 },
    ]);
    expect(await loadBatchQueue()).toEqual([]);
  });

  it("keeps a submitted qualification batch across persistence failures and submits it once", async () => {
    const betaScreen: JD = { ...jd("Beta HQ"), qualifications: null };
    const betaStored = {
      ...betaScreen,
      qualifications: ["TypeScript"],
    };
    provider.batches.set("batches/done", {
      state: "succeeded",
      durationMs: 240_000,
      results: [
        { key: getJobKey(alpha.link), result: JSON.stringify(jd("Alpha HQ")), cost: 0.001 },
        { key: getJobKey(beta.link), result: JSON.stringify(betaScreen), cost: 0.002 },
      ],
    });
    await saveInflightBatches([
      {
        name: "batches/done",
        submittedAt: "2026-09-01T00:00:00.000Z",
        phase: "screen",
        jobs: [alpha, beta],
      },
    ]);
    const getRawJD = vi.spyOn(Posting.prototype, "getRawJD").mockResolvedValue({
      jd: "raw jd",
      error: JD_FETCH_OK,
    });
    provider.submitBatch.mockImplementation(async () => {
      provider.batches.set("batches/quals", {
        state: "succeeded",
        durationMs: 1_000,
        results: [
          {
            key: getJobKey(beta.link),
            result: JSON.stringify({ qualifications: ["TypeScript"] }),
            cost: 0.003,
          },
        ],
      });
      return { name: "batches/quals" };
    });

    const appendJobs = vi.spyOn(store.jobs, "append").mockImplementation(async () => {
      throw new Error("injected interrupt before jobs are stored");
    });

    await expect(processBatchQueue(0)).rejects.toThrow("injected interrupt before jobs are stored");

    expect(provider.submitBatch).toHaveBeenCalledTimes(1);
    const afterJobsFailure = await loadInflightBatches();
    expect(afterJobsFailure.map((batch) => batch.name)).toEqual(["batches/done", "batches/quals"]);
    expect(afterJobsFailure[1]).toEqual(
      expect.objectContaining({
        name: "batches/quals",
        phase: "qualifications",
        jobs: [expect.objectContaining({ link: beta.link, jd: betaScreen })],
      })
    );
    expect(await readNdjson<Job>(JOB_PATH)).toEqual([]);
    expect(await readNdjson<Opportunity>(OPPORTUNITIES_PATH)).toEqual([]);
    expect(provider.batches.has("batches/quals")).toBe(true);
    appendJobs.mockRestore();

    const appendOpportunities = vi
      .spyOn(store.opportunities, "append")
      .mockImplementation(async () => {
        throw new Error("injected interrupt after jobs are stored");
      });

    await expect(processBatchQueue(0)).rejects.toThrow("injected interrupt after jobs are stored");

    expect(provider.submitBatch).toHaveBeenCalledTimes(1);
    expect(await loadInflightBatches()).toEqual(afterJobsFailure);
    const jobsAfterFailure = await fs.readFile(JOB_PATH, "utf-8");
    expect(await readNdjson<Job>(JOB_PATH)).toEqual([
      storedJob(alpha, 1, "Alpha HQ"),
      {
        id: 2,
        company: beta.company,
        role: beta.role,
        link: beta.link,
        location: beta.location,
        jd: betaStored,
      },
    ]);
    expect(await readNdjson<Opportunity>(OPPORTUNITIES_PATH)).toEqual([]);
    appendOpportunities.mockRestore();

    const restart = await processBatchQueue(0);

    expect(provider.submitBatch).toHaveBeenCalledTimes(1);
    expect(restart).toMatchObject({ collected: 2, inflight: 0 });
    expect(await fs.readFile(JOB_PATH, "utf-8")).toBe(jobsAfterFailure);
    expect(await loadInflightBatches()).toEqual([]);
    const opportunities = await readNdjson<Opportunity>(OPPORTUNITIES_PATH);
    expect(opportunities.map(({ postedAt: _postedAt, ...row }) => row)).toEqual([
      { ...storedJob(alpha, 1, "Alpha HQ"), expired: false },
      {
        id: 2,
        company: beta.company,
        role: beta.role,
        link: beta.link,
        location: beta.location,
        jd: betaStored,
        expired: false,
      },
    ]);
    expect(opportunities.map((row) => row.id)).toEqual([1, 2]);

    const opportunitiesAfter = await fs.readFile(OPPORTUNITIES_PATH, "utf-8");
    const again = await processBatchQueue(0);

    expect(again).toMatchObject({ collected: 0, notified: 0, inflight: 0 });
    expect(await fs.readFile(JOB_PATH, "utf-8")).toBe(jobsAfterFailure);
    expect(await fs.readFile(OPPORTUNITIES_PATH, "utf-8")).toBe(opportunitiesAfter);
    expect(provider.submitBatch).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    getRawJD.mockRestore();
  });

  function qualJob(source: Job, screen: JD): Job {
    return { ...source, jd: screen };
  }

  it("reuses a saved replacement after a failed qualification batch when persistence fails", async () => {
    const betaScreen: JD = { ...jd("Beta HQ"), qualifications: null };
    const betaStored = { ...betaScreen, qualifications: ["TypeScript"] };
    const screenBatch = {
      name: "batches/done",
      submittedAt: "2026-09-01T00:00:00.000Z",
      phase: "screen" as const,
      jobs: [alpha, beta],
    };
    const failedBatch = {
      name: "batches/old-quals",
      submittedAt: "2026-09-01T00:05:00.000Z",
      phase: "qualifications" as const,
      jobs: [qualJob(beta, betaScreen)],
      screenCosts: { [getJobKey(beta.link)]: 0.002 },
    };
    const replacementBatch = {
      name: "batches/new-quals",
      submittedAt: "2026-09-01T00:06:00.000Z",
      phase: "qualifications" as const,
      jobs: [qualJob(beta, betaScreen)],
      screenCosts: { [getJobKey(beta.link)]: 0.002 },
    };
    provider.batches.set("batches/done", {
      state: "succeeded",
      durationMs: 240_000,
      results: [
        { key: getJobKey(alpha.link), result: JSON.stringify(jd("Alpha HQ")), cost: 0.001 },
        { key: getJobKey(beta.link), result: JSON.stringify(betaScreen), cost: 0.002 },
      ],
    });
    provider.batches.set("batches/old-quals", {
      state: "failed",
      error: "provider failed the qualification batch",
    });
    provider.batches.set("batches/new-quals", {
      state: "succeeded",
      durationMs: 1_000,
      results: [
        {
          key: getJobKey(beta.link),
          result: JSON.stringify({ qualifications: ["TypeScript"] }),
          cost: 0.003,
        },
      ],
    });
    await saveInflightBatches([screenBatch, failedBatch, replacementBatch]);
    const inflightBefore = await fs.readFile(BATCH_INFLIGHT_PATH, "utf-8");
    const appendJobs = vi.spyOn(store.jobs, "append").mockImplementation(async () => {
      throw new Error("injected interrupt before jobs are stored");
    });

    await expect(processBatchQueue(0)).rejects.toThrow("injected interrupt before jobs are stored");

    expect(provider.submitBatch).not.toHaveBeenCalled();
    expect(await fs.readFile(BATCH_INFLIGHT_PATH, "utf-8")).toBe(inflightBefore);
    expect(await loadInflightBatches()).toEqual([screenBatch, failedBatch, replacementBatch]);
    expect(await readNdjson<Job>(JOB_PATH)).toEqual([]);
    expect(await readNdjson<Opportunity>(OPPORTUNITIES_PATH)).toEqual([]);
    appendJobs.mockRestore();

    const restart = await processBatchQueue(0);

    expect(provider.submitBatch).not.toHaveBeenCalled();
    expect(restart).toMatchObject({ collected: 2, inflight: 0 });
    expect(await readNdjson<Job>(JOB_PATH)).toEqual([
      storedJob(alpha, 1, "Alpha HQ"),
      {
        id: 2,
        company: beta.company,
        role: beta.role,
        link: beta.link,
        location: beta.location,
        jd: betaStored,
      },
    ]);
    const opportunities = await readNdjson<Opportunity>(OPPORTUNITIES_PATH);
    expect(opportunities.map(({ postedAt: _postedAt, ...row }) => row)).toEqual([
      { ...storedJob(alpha, 1, "Alpha HQ"), expired: false },
      {
        id: 2,
        company: beta.company,
        role: beta.role,
        link: beta.link,
        location: beta.location,
        jd: betaStored,
        expired: false,
      },
    ]);
    expect(new Set(opportunities.map((row) => row.id))).toEqual(new Set([1, 2]));
    expect(await loadInflightBatches()).toEqual([]);

    const jobsAfter = await fs.readFile(JOB_PATH, "utf-8");
    const opportunitiesAfter = await fs.readFile(OPPORTUNITIES_PATH, "utf-8");
    const again = await processBatchQueue(0);

    expect(again).toMatchObject({ collected: 0, notified: 0, inflight: 0 });
    expect(await fs.readFile(JOB_PATH, "utf-8")).toBe(jobsAfter);
    expect(await fs.readFile(OPPORTUNITIES_PATH, "utf-8")).toBe(opportunitiesAfter);
    expect(provider.submitBatch).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries a failed qualification batch once when no replacement is tracked", async () => {
    const betaScreen: JD = { ...jd("Beta HQ"), qualifications: null };
    const betaStored = { ...betaScreen, qualifications: ["TypeScript"] };
    const failedBatch = {
      name: "batches/old-quals",
      submittedAt: "2026-09-01T00:05:00.000Z",
      phase: "qualifications" as const,
      jobs: [qualJob(beta, betaScreen)],
      screenCosts: { [getJobKey(beta.link)]: 0.002 },
    };
    provider.batches.set("batches/old-quals", {
      state: "failed",
      error: "provider failed the qualification batch",
    });
    await saveInflightBatches([failedBatch]);
    const getRawJD = vi.spyOn(Posting.prototype, "getRawJD").mockResolvedValue({
      jd: "raw jd",
      error: JD_FETCH_OK,
    });
    provider.submitBatch.mockImplementation(async () => {
      provider.batches.set("batches/retry", {
        state: "succeeded",
        durationMs: 1_000,
        results: [
          {
            key: getJobKey(beta.link),
            result: JSON.stringify({ qualifications: ["TypeScript"] }),
            cost: 0.003,
          },
        ],
      });
      return { name: "batches/retry" };
    });

    const first = await processBatchQueue(0);

    expect(provider.submitBatch).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ collected: 0, notified: 0, inflight: 1 });
    const saved = await loadInflightBatches();
    expect(saved).toEqual([
      expect.objectContaining({
        name: "batches/retry",
        phase: "qualifications",
        jobs: [expect.objectContaining({ link: beta.link, jd: betaScreen })],
        screenCosts: { [getJobKey(beta.link)]: 0.002 },
      }),
    ]);
    expect(saved.some((batch) => batch.name === "batches/old-quals")).toBe(false);
    expect(await readNdjson<Job>(JOB_PATH)).toEqual([]);

    const restart = await processBatchQueue(0);

    expect(provider.submitBatch).toHaveBeenCalledTimes(1);
    expect(restart).toMatchObject({ collected: 1, inflight: 0 });
    expect(await readNdjson<Job>(JOB_PATH)).toEqual([
      {
        id: 1,
        company: beta.company,
        role: beta.role,
        link: beta.link,
        location: beta.location,
        jd: betaStored,
      },
    ]);
    const opportunities = await readNdjson<Opportunity>(OPPORTUNITIES_PATH);
    expect(opportunities.map(({ postedAt: _postedAt, ...row }) => row)).toEqual([
      {
        id: 1,
        company: beta.company,
        role: beta.role,
        link: beta.link,
        location: beta.location,
        jd: betaStored,
        expired: false,
      },
    ]);
    expect(await loadInflightBatches()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    getRawJD.mockRestore();
  });
});
