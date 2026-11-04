import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Constants from "@/constants";
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
    {
      state: "succeeded";
      durationMs: number;
      results: Array<{ key: string; result: string; cost: number }>;
    }
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

vi.mock("@/constants", async (importOriginal) => {
  const actual = await importOriginal<typeof Constants>();
  const nodePath = await import("node:path");
  const data = () => nodePath.join(paths.root, "data");

  return {
    ...actual,
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
  };
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

import { BATCH_INFLIGHT_PATH, JOB_PATH, OPPORTUNITIES_PATH } from "@/constants";

import { persistAnalyzedJobs } from "../../ingest";
import { processBatchQueue } from "../batch";

import { getJobKey } from "@/modules/ats/job-key";
import {
  collectInflightBatches,
  loadBatchQueue,
  loadInflightBatches,
  saveInflightBatches,
} from "@/modules/postings/batch";
import * as data from "@/utils/data";
import { JobCategory } from "@/validation/config";

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

  it("drops a finished batch when saving inflight succeeds and storing the analysis then fails", async () => {
    provider.batches.set("batches/done", {
      state: "succeeded",
      durationMs: 240_000,
      results: [
        { key: getJobKey(alpha.link), result: JSON.stringify(jd("Alpha HQ")), cost: 0.001 },
      ],
    });
    await saveInflightBatches([
      {
        name: "batches/done",
        submittedAt: "2026-09-01T00:00:00.000Z",
        phase: "screen",
        jobs: [alpha],
      },
    ]);

    let inflightWhenJobSaveStarts: string | undefined;
    const saveJob = vi.spyOn(data, "saveJob").mockImplementation(async () => {
      inflightWhenJobSaveStarts = await fs.readFile(BATCH_INFLIGHT_PATH, "utf-8");
      throw new Error("injected interrupt before analysis results are stored");
    });

    await expect(processBatchQueue(0)).rejects.toThrow(
      "injected interrupt before analysis results are stored"
    );

    expect(inflightWhenJobSaveStarts).toBe(`${JSON.stringify([], null, 2)}\n`);
    expect(await readNdjson<Job>(JOB_PATH)).toEqual([]);
    expect(await readNdjson<Opportunity>(OPPORTUNITIES_PATH)).toEqual([]);
    saveJob.mockRestore();

    const restart = await processBatchQueue(0);

    expect(restart).toMatchObject({ collected: 0, notified: 0, inflight: 0 });
    expect(await loadInflightBatches()).toEqual([]);
    expect(await readNdjson<Job>(JOB_PATH)).toEqual([]);
    expect(await readNdjson<Opportunity>(OPPORTUNITIES_PATH)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("assigns an unmatched result to the job at that index, then fails before those jobs are stored", async () => {
    provider.batches.set("batches/done", {
      state: "succeeded",
      durationMs: 240_000,
      results: [
        { key: getJobKey(beta.link), result: JSON.stringify(jd("Beta keyed")), cost: 0.002 },
        { key: "missing-batch-key", result: JSON.stringify(jd("Index slot 1")), cost: 0.004 },
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

    const collected = await collectInflightBatches();

    expect(collected.analyzed).toEqual([
      { job: beta, jd: jd("Beta keyed"), cost: 0.002 },
      { job: beta, jd: jd("Index slot 1"), cost: 0.004 },
    ]);
    expect(await loadBatchQueue()).toEqual([alpha]);
    expect(await loadInflightBatches()).toEqual([]);

    await expect(persistAnalyzedJobs(collected.analyzed)).rejects.toThrow(/postedAt/);
    expect(await readNdjson<Job>(JOB_PATH)).toEqual([]);
    expect(await readNdjson<Opportunity>(OPPORTUNITIES_PATH)).toEqual([]);

    const restart = await processBatchQueue(0);

    expect(restart).toMatchObject({ collected: 0, notified: 0, inflight: 0 });
    expect(await readNdjson<Job>(JOB_PATH)).toEqual([]);
    expect(await loadBatchQueue()).toEqual([alpha]);
  });
});
