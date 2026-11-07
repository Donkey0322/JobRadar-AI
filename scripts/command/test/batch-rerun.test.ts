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
    batchApi: true,
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
    get BATCH_FAILURES_PATH() {
      return nodePath.join(data(), "batch", "failures.ndjson");
    },
    get BATCH_RESULTS_PATH() {
      return nodePath.join(data(), "batch", "results.ndjson");
    },
    JOB_ARCHIVE_CHUNK: 1000,
    OPPORTUNITY_ARCHIVE_CHUNK: 5000,
  } satisfies Partial<typeof StorePaths> & Record<string, unknown>;
});

vi.mock("@/utils/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof AI>();
  return {
    ...actual,
    default: (prompt: string, schema: unknown, options?: { model?: string }) =>
      provider.generate(prompt, schema, options?.model, options),
    getAIProvider: () => ({
      generate: provider.generate,
      validateModel: vi.fn(),
      ...(provider.batchApi
        ? { submitBatch: provider.submitBatch, getBatch: provider.getBatch }
        : {}),
    }),
  };
});

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { renderSummary } from "@github/scripts/summary.mjs";

import { JobCategory } from "@/constants/job-category";
import { SEASONS } from "@/constants/season";

import type { MockInstance } from "vitest";

import runBatch, { processBatchQueue } from "../batch";

import { CONFIG } from "@/config";
import { getJobKey } from "@/modules/ats/job-key";
import {
  collectInflightBatches,
  enqueueBatchJobs,
  loadBatchQueue,
  loadInflightBatches,
  saveInflightBatches,
  submitQueuedJobs,
} from "@/modules/posting/batch";
import { JD_FETCH_OK } from "@/modules/posting/jd";
import { Posting } from "@/modules/posting/posting";
import * as store from "@/store";
import {
  BATCH_FAILURES_PATH,
  BATCH_INFLIGHT_PATH,
  BATCH_QUEUE_PATH,
  BATCH_RESULTS_PATH,
  JOB_PATH,
  OPPORTUNITIES_PATH,
} from "@/store/paths";
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

  it("records each batch pass once, including a replay that adds no cost", async () => {
    const summaryDir = path.join(paths.root, "summary");
    const official = path.join(paths.root, "official.md");
    await fs.writeFile(official, "OFFICIAL\n");
    process.env.JOBRADAR_SUMMARY_DIR = summaryDir;
    process.env.GITHUB_STEP_SUMMARY = official;

    try {
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

      await runBatch();
      await runBatch();

      const jobsAfter = await fs.readFile(JOB_PATH, "utf-8");
      await runBatch();
      expect(await fs.readFile(JOB_PATH, "utf-8")).toBe(jobsAfter);

      const { markdown } = renderSummary({
        dir: summaryDir,
        summaryPath: path.join(paths.root, "rendered.md"),
      });
      const costs = [...markdown.matchAll(/\| AI cost this pass \| ([0-9.]+) \|/g)].map(
        (match) => match[1]
      );
      expect(costs).toEqual(["0.003", "0", "0"]);
      expect(markdown).not.toContain("0.006");
      expect(markdown).not.toContain("0.009");
      expect(markdown).not.toContain("test-fake-ai-key");
      expect(markdown).not.toContain("Software Engineer Intern");
      expect(markdown).not.toContain("greenhouse.io");
      expect(markdown).not.toContain("Bachelor");
      expect(await fs.readFile(official, "utf8")).toBe("OFFICIAL\n");
    } finally {
      delete process.env.JOBRADAR_SUMMARY_DIR;
      delete process.env.GITHUB_STEP_SUMMARY;
    }
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

describe("batch retries of invalid AI results", () => {
  const dirs: string[] = [];
  const ai = CONFIG.ai;
  const alphaKey = getJobKey(alpha.link);
  const invalidAlpha = JSON.stringify({ ...jd("Alpha HQ"), season: SEASONS.fall });
  const validAlpha = JSON.stringify(jd("Alpha HQ"));
  const at = (minute: number) => `2026-11-07T09:0${minute}:00.000Z`;
  let getRawJD: MockInstance<Posting["getRawJD"]>;

  beforeEach(async () => {
    paths.root = await fs.mkdtemp(path.join(os.tmpdir(), "jobradar-batch-retry-"));
    dirs.push(paths.root);
    provider.batches.clear();
    provider.generate.mockReset();
    provider.submitBatch.mockReset();
    provider.getBatch.mockClear();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => {
      throw new Error("batch retries must not use the network");
    });
    vi.stubGlobal("fetch", fetchMock);
    process.env.AI_API_KEY = "test-fake-ai-key";
    CONFIG.ai = { enabled: true, provider: "google", model: "test-model" };
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(at(0)));
    getRawJD = vi
      .spyOn(Posting.prototype, "getRawJD")
      .mockResolvedValue({ jd: "raw jd", error: JD_FETCH_OK });

    expect(BATCH_FAILURES_PATH.startsWith(paths.root)).toBe(true);
  });

  afterEach(async () => {
    getRawJD.mockRestore();
    provider.batchApi = true;
    vi.useRealTimers();
    CONFIG.ai = ai;
    vi.unstubAllGlobals();
    await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  async function saveFirstBatch() {
    provider.batches.set("batches/done", {
      state: "succeeded",
      durationMs: 240_000,
      results: [
        { key: alphaKey, result: invalidAlpha, cost: 0.001 },
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
  }

  /** The provider finishes the next submitted batch with one result per request. */
  function nextBatch(name: string, result: string, cost: number) {
    provider.submitBatch.mockImplementationOnce(async (requests: Array<{ key: string }>) => {
      provider.batches.set(name, {
        state: "succeeded",
        durationMs: 1_000,
        results: requests.map((request) => ({ key: request.key, result, cost })),
      });
      return { name };
    });
  }

  async function submitAndCollect(name: string, result: string, cost: number, minute: number) {
    vi.setSystemTime(new Date(at(minute)));
    nextBatch(name, result, cost);
    expect(await submitQueuedJobs()).toEqual({ submitted: 1, analyzed: [] });
    return processBatchQueue(0);
  }

  function attempt(id: string, minute: number, cost: number, round = 0) {
    return { id, at: at(minute), failure: { stage: "ai", reason: "invalid" }, cost, round };
  }

  function failure(overrides: Record<string, unknown>) {
    return {
      key: alphaKey,
      job: alpha,
      status: "retrying",
      failure: { stage: "ai", reason: "invalid" },
      firstFailedAt: at(0),
      manualRetries: 0,
      ...overrides,
    };
  }

  const loadFailures = () => readNdjson<Record<string, unknown>>(BATCH_FAILURES_PATH);
  const storedLinks = async () => (await readNdjson<Job>(JOB_PATH)).map((row) => row.link);

  async function seedFailures(records: unknown[]) {
    await fs.mkdir(path.dirname(BATCH_FAILURES_PATH), { recursive: true });
    await fs.writeFile(
      BATCH_FAILURES_PATH,
      records.map((record) => `${JSON.stringify(record)}\n`).join(""),
      "utf-8"
    );
  }

  /** Answers real-time calls in order per company, as a provider without a Batch API. */
  function realtimeAnswers(answers: Record<string, string[]>, cost = 0.01) {
    provider.batchApi = false;
    getRawJD.mockImplementation(async function (this: Posting) {
      return { jd: `raw ${this.company}`, error: JD_FETCH_OK };
    });
    provider.generate.mockImplementation(async (prompt: string) => {
      const company = Object.keys(answers).find((name) => prompt.includes(`raw ${name}`));
      return { result: (company && answers[company]?.shift()) ?? null, cost };
    });
  }

  const realtimeAttempt = (minute: number, cost: number, round = 0) => ({
    ...attempt("", minute, cost, round),
    id: expect.stringMatching(/^realtime:[0-9a-f-]{36}$/),
  });

  it("re-queues an invalid result and clears its record once a later batch succeeds", async () => {
    await saveFirstBatch();

    const first = await processBatchQueue(0);

    expect(first).toMatchObject({ collected: 1, totalCost: 0.002, inflight: 0 });
    expect(await loadInflightBatches()).toEqual([]);
    expect(await loadBatchQueue()).toEqual([alpha]);
    expect(await loadFailures()).toEqual([
      failure({
        attempts: [attempt("batches/done", 0, 0.001)],
        cost: 0.001,
        lastFailedAt: at(0),
      }),
    ]);

    const second = await submitAndCollect("batches/retry-1", validAlpha, 0.004, 1);

    expect(second).toMatchObject({ collected: 1, notified: 1, totalCost: 0.004, inflight: 0 });
    expect(await loadFailures()).toEqual([]);
    expect(await loadBatchQueue()).toEqual([]);
    expect(await storedLinks()).toEqual([beta.link, alpha.link]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sets a job aside after three attempts across runs, and --retry-failed runs it through the batch again", async () => {
    await saveFirstBatch();
    await processBatchQueue(0);
    await submitAndCollect("batches/retry-1", invalidAlpha, 0.002, 1);

    expect(await loadFailures()).toEqual([
      failure({
        attempts: [attempt("batches/done", 0, 0.001), attempt("batches/retry-1", 1, 0.002)],
        cost: 0.003,
        lastFailedAt: at(1),
      }),
    ]);
    expect(await loadBatchQueue()).toEqual([alpha]);

    await submitAndCollect("batches/retry-2", invalidAlpha, 0.003, 2);

    const setAside = failure({
      status: "failed",
      attempts: [
        attempt("batches/done", 0, 0.001),
        attempt("batches/retry-1", 1, 0.002),
        attempt("batches/retry-2", 2, 0.003),
      ],
      cost: expect.closeTo(0.006),
      lastFailedAt: at(2),
    });
    expect(await loadFailures()).toEqual([setAside]);
    expect(await loadBatchQueue()).toEqual([]);
    expect(await loadInflightBatches()).toEqual([]);
    expect(await storedLinks()).toEqual([beta.link]);

    await processBatchQueue(0);

    expect(provider.submitBatch).toHaveBeenCalledTimes(2);
    expect(await loadFailures()).toEqual([setAside]);

    vi.setSystemTime(new Date(at(3)));
    nextBatch("batches/manual", validAlpha, 0.005);
    await runBatch({ submitOnly: true, retryFailed: true });

    expect(provider.submitBatch).toHaveBeenCalledTimes(3);
    expect(await loadFailures()).toEqual([
      failure({
        attempts: [
          attempt("batches/done", 0, 0.001),
          attempt("batches/retry-1", 1, 0.002),
          attempt("batches/retry-2", 2, 0.003),
        ],
        cost: expect.closeTo(0.006),
        lastFailedAt: at(2),
        manualRetries: 1,
      }),
    ]);
    expect(await loadBatchQueue()).toEqual([]);
    expect(await loadInflightBatches()).toEqual([
      expect.objectContaining({ name: "batches/manual", jobs: [alpha] }),
    ]);

    const collected = await processBatchQueue(0);

    expect(collected).toMatchObject({ collected: 1, totalCost: 0.005, inflight: 0 });
    expect(await loadFailures()).toEqual([]);
    expect(await storedLinks()).toEqual([beta.link, alpha.link]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not count an attempt or its cost twice when the same results are collected again", async () => {
    await saveFirstBatch();
    const inflightBefore = await loadInflightBatches();
    const appendJobs = vi.spyOn(store.jobs, "append").mockImplementation(async () => {
      throw new Error("injected interrupt before jobs are stored");
    });

    await expect(processBatchQueue(0)).rejects.toThrow("injected interrupt before jobs are stored");
    appendJobs.mockRestore();

    const recorded = [
      failure({ attempts: [attempt("batches/done", 0, 0.001)], cost: 0.001, lastFailedAt: at(0) }),
    ];
    expect(await loadFailures()).toEqual(recorded);
    expect(await loadInflightBatches()).toEqual(inflightBefore);

    vi.setSystemTime(new Date(at(5)));
    const restart = await processBatchQueue(0);

    expect(restart).toMatchObject({ collected: 1, inflight: 0 });
    expect(await loadFailures()).toEqual(recorded);
    expect(await loadBatchQueue()).toEqual([alpha]);

    await saveInflightBatches(inflightBefore);
    await collectInflightBatches();

    expect(await loadFailures()).toEqual(recorded);
    expect(await loadBatchQueue()).toEqual([alpha]);
  });

  it("keeps the batch inflight when the failure record cannot be saved, then records it on rerun", async () => {
    await saveFirstBatch();
    await processBatchQueue(0);
    await submitAndCollect("batches/retry-1", invalidAlpha, 0.002, 1);
    const beforeCap = await loadFailures();

    vi.setSystemTime(new Date(at(2)));
    nextBatch("batches/retry-2", invalidAlpha, 0.003);
    await submitQueuedJobs();
    const saveFailures = vi.spyOn(store.batchFailures, "save").mockImplementation(async () => {
      throw new Error("injected interrupt while saving failures");
    });

    await expect(processBatchQueue(0)).rejects.toThrow("injected interrupt while saving failures");
    saveFailures.mockRestore();

    expect(await loadFailures()).toEqual(beforeCap);
    expect(await loadBatchQueue()).toEqual([]);
    expect(await loadInflightBatches()).toEqual([
      expect.objectContaining({ name: "batches/retry-2", jobs: [alpha] }),
    ]);

    await processBatchQueue(0);

    expect(await loadFailures()).toEqual([
      failure({
        status: "failed",
        attempts: [
          attempt("batches/done", 0, 0.001),
          attempt("batches/retry-1", 1, 0.002),
          attempt("batches/retry-2", 2, 0.003),
        ],
        cost: expect.closeTo(0.006),
        lastFailedAt: at(2),
      }),
    ]);
    expect(await loadInflightBatches()).toEqual([]);
    expect(await loadBatchQueue()).toEqual([]);
  });

  it("counts an old inflight result once after --retry-failed and gives the new round three attempts", async () => {
    // Written before attempts had a round: a round-less attempt belongs to the current round.
    await seedFailures([
      {
        ...failure({ cost: 0.003, lastFailedAt: at(1) }),
        attempts: [
          { id: "batches/r0", at: at(0), failure: { stage: "ai", reason: "invalid" }, cost: 0.001 },
          { id: "batches/r1", at: at(1), failure: { stage: "ai", reason: "invalid" }, cost: 0.002 },
        ],
      },
    ]);
    provider.batches.set("batches/mixed", {
      state: "succeeded",
      durationMs: 1_000,
      results: [
        { key: alphaKey, result: invalidAlpha, cost: 0.003 },
        { key: getJobKey(beta.link), result: JSON.stringify(jd("Beta HQ")), cost: 0.002 },
      ],
    });
    await saveInflightBatches([
      { name: "batches/mixed", submittedAt: at(1), phase: "screen", jobs: [alpha, beta] },
    ]);
    vi.setSystemTime(new Date(at(2)));
    const appendJobs = vi.spyOn(store.jobs, "append").mockImplementation(async () => {
      throw new Error("injected interrupt before jobs are stored");
    });

    await expect(processBatchQueue(0)).rejects.toThrow("injected interrupt before jobs are stored");
    appendJobs.mockRestore();

    const firstRound = [
      attempt("batches/r0", 0, 0.001),
      attempt("batches/r1", 1, 0.002),
      attempt("batches/mixed", 2, 0.003),
    ];
    expect(await loadFailures()).toEqual([
      failure({
        status: "failed",
        attempts: firstRound,
        cost: expect.closeTo(0.006),
        lastFailedAt: at(2),
      }),
    ]);
    expect(await loadInflightBatches()).toEqual([
      expect.objectContaining({ name: "batches/mixed", jobs: [alpha, beta] }),
    ]);

    vi.setSystemTime(new Date(at(3)));
    nextBatch("batches/manual-1", invalidAlpha, 0.004);
    await runBatch({ retryFailed: true, submitOnly: true });

    expect(await loadFailures()).toEqual([
      failure({
        attempts: firstRound,
        cost: expect.closeTo(0.006),
        lastFailedAt: at(2),
        manualRetries: 1,
      }),
    ]);
    expect(await storedLinks()).toEqual([beta.link]);
    expect(await loadBatchQueue()).toEqual([]);
    expect(await loadInflightBatches()).toEqual([
      expect.objectContaining({ name: "batches/manual-1", jobs: [alpha] }),
    ]);

    vi.setSystemTime(new Date(at(4)));
    await processBatchQueue(0);
    await submitAndCollect("batches/manual-2", invalidAlpha, 0.004, 5);

    expect(await loadFailures()).toEqual([
      failure({
        attempts: [
          ...firstRound,
          attempt("batches/manual-1", 4, 0.004, 1),
          attempt("batches/manual-2", 5, 0.004, 1),
        ],
        cost: expect.closeTo(0.014),
        lastFailedAt: at(5),
        manualRetries: 1,
      }),
    ]);
    expect(await loadBatchQueue()).toEqual([alpha]);

    await submitAndCollect("batches/manual-3", invalidAlpha, 0.004, 6);

    expect(await loadFailures()).toEqual([
      failure({
        status: "failed",
        attempts: [
          ...firstRound,
          attempt("batches/manual-1", 4, 0.004, 1),
          attempt("batches/manual-2", 5, 0.004, 1),
          attempt("batches/manual-3", 6, 0.004, 1),
        ],
        cost: expect.closeTo(0.018),
        lastFailedAt: at(6),
        manualRetries: 1,
      }),
    ]);
    expect(await loadBatchQueue()).toEqual([]);
    expect(await loadInflightBatches()).toEqual([]);
    expect(await storedLinks()).toEqual([beta.link]);
  });

  it("recovers when the manual retry cannot save its record", async () => {
    const setAside = failure({
      status: "failed",
      attempts: [
        attempt("batches/done", 0, 0.001),
        attempt("batches/retry-1", 1, 0.002),
        attempt("batches/retry-2", 2, 0.003),
      ],
      cost: 0.006,
      lastFailedAt: at(2),
    });
    await seedFailures([setAside]);
    const saveFailures = vi
      .spyOn(store.batchFailures, "save")
      .mockRejectedValueOnce(new Error("injected interrupt while saving the manual retry"));

    await expect(runBatch({ retryFailed: true, submitOnly: true })).rejects.toThrow(
      "injected interrupt while saving the manual retry"
    );
    saveFailures.mockRestore();

    expect(await loadFailures()).toEqual([setAside]);
    expect(await loadBatchQueue()).toEqual([alpha]);

    expect(await submitQueuedJobs()).toEqual({ submitted: 0, analyzed: [] });
    expect(provider.submitBatch).not.toHaveBeenCalled();
    expect(await loadBatchQueue()).toEqual([]);
    expect(await loadFailures()).toEqual([setAside]);

    vi.setSystemTime(new Date(at(3)));
    nextBatch("batches/manual", validAlpha, 0.005);
    await runBatch({ retryFailed: true, submitOnly: true });

    expect(await loadFailures()).toEqual([{ ...setAside, status: "retrying", manualRetries: 1 }]);
    expect(await loadInflightBatches()).toEqual([
      expect.objectContaining({ name: "batches/manual", jobs: [alpha] }),
    ]);

    await processBatchQueue(0);

    expect(await loadFailures()).toEqual([]);
    expect(await storedLinks()).toEqual([alpha.link]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries invalid real-time answers without a Batch API, sets the job aside, and reruns it by hand", async () => {
    realtimeAnswers({
      Alpha: [invalidAlpha, invalidAlpha, invalidAlpha, validAlpha],
      Beta: [JSON.stringify(jd("Beta HQ"))],
    });
    await enqueueBatchJobs([alpha, beta]);

    const first = await processBatchQueue(undefined, { wait: false });

    // Beta's result keeps the submit loop going, so Alpha gets a second call in the same run.
    expect(first).toMatchObject({ submitted: 0, notified: 1, totalCost: 0.01 });
    expect(await storedLinks()).toEqual([beta.link]);
    expect(await loadBatchQueue()).toEqual([alpha]);
    expect(await loadFailures()).toEqual([
      failure({
        failure: { stage: "ai", reason: "invalid" },
        attempts: [realtimeAttempt(0, 0.01), realtimeAttempt(0, 0.01)],
        cost: 0.02,
        lastFailedAt: at(0),
      }),
    ]);

    vi.setSystemTime(new Date(at(1)));
    await processBatchQueue(undefined, { wait: false });

    const [setAside] = await loadFailures();
    expect(setAside).toEqual(
      failure({
        status: "failed",
        attempts: [realtimeAttempt(0, 0.01), realtimeAttempt(0, 0.01), realtimeAttempt(1, 0.01)],
        cost: expect.closeTo(0.03),
        lastFailedAt: at(1),
      })
    );
    const ids = (setAside?.attempts as Array<{ id: string }>).map((item) => item.id);
    expect(new Set(ids).size).toBe(3);
    expect(await loadBatchQueue()).toEqual([]);
    expect(provider.generate).toHaveBeenCalledTimes(4);

    await processBatchQueue(undefined, { wait: false });

    expect(provider.generate).toHaveBeenCalledTimes(4);

    vi.setSystemTime(new Date(at(2)));
    await runBatch({ retryFailed: true, submitOnly: true });

    expect(provider.generate).toHaveBeenCalledTimes(5);
    expect(await loadFailures()).toEqual([]);
    expect(await loadBatchQueue()).toEqual([]);
    expect(await storedLinks()).toEqual([beta.link, alpha.link]);
    expect(provider.submitBatch).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a real-time success queued and tracked until it is stored", async () => {
    const tracked = failure({
      attempts: [{ ...attempt("realtime:earlier", 0, 0.01) }],
      cost: 0.01,
      lastFailedAt: at(0),
    });
    await seedFailures([tracked]);
    await enqueueBatchJobs([alpha]);
    realtimeAnswers({ Alpha: [validAlpha, validAlpha] });
    const appendJobs = vi.spyOn(store.jobs, "append").mockImplementation(async () => {
      throw new Error("injected interrupt before jobs are stored");
    });

    await expect(processBatchQueue(undefined, { wait: false })).rejects.toThrow(
      "injected interrupt before jobs are stored"
    );
    appendJobs.mockRestore();

    expect(await loadBatchQueue()).toEqual([alpha]);
    expect(await loadFailures()).toEqual([tracked]);
    expect(await storedLinks()).toEqual([]);

    await processBatchQueue(undefined, { wait: false });

    expect(await storedLinks()).toEqual([alpha.link]);
    expect(await loadFailures()).toEqual([]);
    expect(await loadBatchQueue()).toEqual([]);
  });

  it("keeps a real-time job queued when its final failure cannot be saved", async () => {
    const earlier = [attempt("realtime:a", 0, 0.01), attempt("realtime:b", 0, 0.01)];
    const tracked = failure({
      attempts: earlier,
      cost: 0.02,
      lastFailedAt: at(0),
    });
    await seedFailures([tracked]);
    await enqueueBatchJobs([alpha]);
    realtimeAnswers({ Alpha: [invalidAlpha, invalidAlpha] });
    vi.setSystemTime(new Date(at(1)));
    const saveFailures = vi
      .spyOn(store.batchFailures, "save")
      .mockRejectedValueOnce(new Error("injected interrupt while saving failures"));

    await expect(processBatchQueue(undefined, { wait: false })).rejects.toThrow(
      "injected interrupt while saving failures"
    );
    saveFailures.mockRestore();

    expect(await loadBatchQueue()).toEqual([alpha]);
    expect(await loadFailures()).toEqual([tracked]);

    await processBatchQueue(undefined, { wait: false });

    expect(await loadFailures()).toEqual([
      failure({
        status: "failed",
        attempts: [...earlier, realtimeAttempt(1, 0.01)],
        cost: expect.closeTo(0.03),
        lastFailedAt: at(1),
      }),
    ]);
    expect(await loadBatchQueue()).toEqual([]);
  });

  describe("saved real-time results", () => {
    const loadResults = () => readNdjson<Record<string, unknown>>(BATCH_RESULTS_PATH);
    const savedAlpha = (minute: number) => ({
      key: alphaKey,
      job: alpha,
      jd: jd("Alpha HQ"),
      attemptId: expect.stringMatching(/^realtime:[0-9a-f-]{36}$/),
      cost: 0.01,
      analyzedAt: at(minute),
    });

    /** Every data file with its content and modification time. */
    async function dataFiles() {
      const root = path.join(paths.root, "data");
      const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
      const files = await Promise.all(
        entries
          .filter((entry) => entry.isFile())
          .map(async (entry) => {
            const file = path.join(entry.parentPath, entry.name);
            const [body, stat] = await Promise.all([fs.readFile(file, "utf-8"), fs.stat(file)]);
            return [path.relative(root, file), { body, mtimeMs: stat.mtimeMs }] as const;
          })
      );
      return Object.fromEntries(files);
    }

    async function expectStoredOnce() {
      expect(await readNdjson<Job>(JOB_PATH)).toEqual([storedJob(alpha, 1, "Alpha HQ")]);
      const opportunities = await readNdjson<Opportunity>(OPPORTUNITIES_PATH);
      expect(opportunities.map(({ postedAt: _postedAt, ...row }) => row)).toEqual([
        { ...storedJob(alpha, 1, "Alpha HQ"), expired: false },
      ]);
      expect(await loadResults()).toEqual([]);
      expect(await loadFailures()).toEqual([]);
      expect(await loadBatchQueue()).toEqual([]);
    }

    async function expectQuietRerun() {
      const before = await dataFiles();
      const calls = provider.generate.mock.calls.length;
      const fetches = getRawJD.mock.calls.length;

      const again = await processBatchQueue(undefined, { wait: false });

      expect(again).toMatchObject({ notified: 0, totalCost: 0 });
      expect(await dataFiles()).toEqual(before);
      expect(provider.generate).toHaveBeenCalledTimes(calls);
      expect(getRawJD).toHaveBeenCalledTimes(fetches);
    }

    it("stores the saved JD on rerun after jobs fail, even when the next AI answer is invalid", async () => {
      await enqueueBatchJobs([alpha]);
      realtimeAnswers({ Alpha: [validAlpha, invalidAlpha] });
      const appendJobs = vi.spyOn(store.jobs, "append").mockImplementation(async () => {
        throw new Error("injected interrupt before jobs are stored");
      });

      await expect(processBatchQueue(undefined, { wait: false })).rejects.toThrow(
        "injected interrupt before jobs are stored"
      );
      appendJobs.mockRestore();

      expect(await loadResults()).toEqual([savedAlpha(0)]);
      expect(await loadBatchQueue()).toEqual([alpha]);
      expect(await storedLinks()).toEqual([]);

      vi.setSystemTime(new Date(at(1)));
      const rerun = await processBatchQueue(undefined, { wait: false });

      expect(rerun).toMatchObject({ notified: 1, totalCost: 0.01 });
      await expectStoredOnce();
      expect(provider.generate).toHaveBeenCalledTimes(1);
      expect(getRawJD).toHaveBeenCalledTimes(1);

      await expectQuietRerun();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("fills opportunities with the same ID after they fail, without another AI call", async () => {
      await enqueueBatchJobs([alpha]);
      realtimeAnswers({ Alpha: [validAlpha, invalidAlpha] });
      const appendOpportunities = vi
        .spyOn(store.opportunities, "append")
        .mockImplementation(async () => {
          throw new Error("injected interrupt after jobs are stored");
        });

      await expect(processBatchQueue(undefined, { wait: false })).rejects.toThrow(
        "injected interrupt after jobs are stored"
      );
      appendOpportunities.mockRestore();

      const jobsAfterFailure = await fs.readFile(JOB_PATH, "utf-8");
      expect(await readNdjson<Job>(JOB_PATH)).toEqual([storedJob(alpha, 1, "Alpha HQ")]);
      expect(await readNdjson<Opportunity>(OPPORTUNITIES_PATH)).toEqual([]);
      expect(await loadResults()).toEqual([savedAlpha(0)]);

      await processBatchQueue(undefined, { wait: false });

      expect(await fs.readFile(JOB_PATH, "utf-8")).toBe(jobsAfterFailure);
      await expectStoredOnce();
      expect(provider.generate).toHaveBeenCalledTimes(1);

      await expectQuietRerun();
    });

    it.each([
      ["failure records", () => store.batchFailures, BATCH_FAILURES_PATH],
      ["queue", () => store.batchQueue, BATCH_QUEUE_PATH],
      ["saved results", () => store.batchResults, BATCH_RESULTS_PATH],
    ] as const)(
      "finishes safely on rerun when clearing the %s fails after the data is stored",
      async (_name, target, file) => {
        await seedFailures([
          failure({ attempts: [attempt("realtime:earlier", 0, 0.01)], cost: 0.01, lastFailedAt: at(0) }),
        ]);
        await enqueueBatchJobs([alpha]);
        realtimeAnswers({ Alpha: [validAlpha, invalidAlpha] });
        const dataset = target() as { save(rows: Array<{ link?: string; key?: string }>): Promise<void> };
        const save = dataset.save.bind(dataset);
        const spy = vi.spyOn(dataset, "save").mockImplementation(async (rows) => {
          const keepsAlpha = rows.some((row) => row.link === alpha.link || row.key === alphaKey);
          if (!keepsAlpha) throw new Error(`injected interrupt while clearing ${file}`);
          return save(rows);
        });

        await expect(processBatchQueue(undefined, { wait: false })).rejects.toThrow(
          `injected interrupt while clearing ${file}`
        );
        spy.mockRestore();

        expect(await readNdjson<Job>(JOB_PATH)).toEqual([storedJob(alpha, 1, "Alpha HQ")]);
        expect(await readNdjson<Opportunity>(OPPORTUNITIES_PATH)).toHaveLength(1);
        expect(await loadResults()).toEqual([savedAlpha(0)]);

        await processBatchQueue(undefined, { wait: false });

        await expectStoredOnce();
        expect(provider.generate).toHaveBeenCalledTimes(1);

        await expectQuietRerun();
      }
    );

    it("keeps the job queued and reports that the result was not saved when saving it fails", async () => {
      vi.mocked(logger.error).mockClear();
      await enqueueBatchJobs([alpha]);
      realtimeAnswers({ Alpha: [validAlpha, validAlpha] });
      const saveResults = vi
        .spyOn(store.batchResults, "save")
        .mockRejectedValueOnce(new Error("injected interrupt while saving the result"));

      await expect(processBatchQueue(undefined, { wait: false })).rejects.toThrow(
        "injected interrupt while saving the result"
      );
      saveResults.mockRestore();

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ url: alpha.link, cost: 0.01 }),
        expect.stringContaining("Could not save the real-time result")
      );
      expect(await loadResults()).toEqual([]);
      expect(await loadBatchQueue()).toEqual([alpha]);
      expect(await storedLinks()).toEqual([]);

      vi.setSystemTime(new Date(at(1)));
      const rerun = await processBatchQueue(undefined, { wait: false });

      // The unsaved answer is gone, so the rerun pays for a second AI call.
      expect(provider.generate).toHaveBeenCalledTimes(2);
      expect(rerun).toMatchObject({ notified: 1, totalCost: 0.01 });
      await expectStoredOnce();

      await expectQuietRerun();
    });
  });
});
