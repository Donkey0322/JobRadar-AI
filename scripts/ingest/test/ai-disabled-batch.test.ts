import { promises as fs } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Constants from "@/constants";
import type { Job } from "@/types";
import type * as DataUtils from "@/utils/data";

const env = vi.hoisted(() => {
  const original = {
    AI_API_KEY: process.env.AI_API_KEY,
    AI_MODE: process.env.AI_MODE,
  };

  // utils/ai reads AI_API_KEY at import time, before dotenv could load a real key.
  process.env.AI_API_KEY = "test-fake-ai-key";
  delete process.env.AI_MODE;

  return { original };
});

const tmp = await vi.hoisted(async () => {
  const os = await import("node:os");
  const path = await import("node:path");
  const { mkdtemp } = await import("node:fs/promises");
  const dir = await mkdtemp(path.join(os.tmpdir(), "jobradar-ai-disabled-batch-"));

  return {
    dir,
    queuePath: path.join(dir, "batch", "queue.ndjson"),
    inflightPath: path.join(dir, "batch", "inflight.json"),
  };
});

const ai = vi.hoisted(() => {
  const created: Array<{ provider: string; apiKey: string }> = [];
  const generate = vi.fn();

  function fakeProvider(provider: string) {
    return class {
      generate = generate;
      validateModel = vi.fn();
      submitBatch = vi.fn();
      getBatch = vi.fn();

      constructor(apiKey: string) {
        created.push({ provider, apiKey });
      }
    };
  }

  return { created, generate, fakeProvider };
});

const dataMocks = vi.hoisted(() => ({
  loadOpportunities: vi.fn(),
  saveOpportunities: vi.fn(),
  saveJob: vi.fn(),
  saveUrls: vi.fn(),
}));

const buildCompanyListMock = vi.hoisted(() => vi.fn());

vi.mock("@/constants", async (importOriginal) => {
  const actual = await importOriginal<typeof Constants>();
  return {
    ...actual,
    BATCH_QUEUE_PATH: tmp.queuePath,
    BATCH_INFLIGHT_PATH: tmp.inflightPath,
    CONFIG: {
      ...actual.CONFIG,
      ai: { enabled: false },
    },
  };
});

vi.mock("@/utils/ai/provider/google", () => ({ GoogleProvider: ai.fakeProvider("google") }));
vi.mock("@/utils/ai/provider/openai", () => ({ OpenAIProvider: ai.fakeProvider("openai") }));
vi.mock("@/utils/ai/provider/anthropic", () => ({
  AnthropicProvider: ai.fakeProvider("anthropic"),
}));

vi.mock("@/utils/data", async (importOriginal) => {
  const actual = await importOriginal<typeof DataUtils>();
  return { ...actual, ...dataMocks };
});

vi.mock("@/modules/employer/build", () => ({
  buildCompanyList: buildCompanyListMock,
}));

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { processJobs } from "../index";

import { Posting } from "@/modules/posting";
import {
  loadBatchQueue,
  loadInflightBatches,
  saveBatchQueue,
  submitQueuedJobs,
} from "@/modules/posting/batch";

const fetchMock = vi.fn<typeof fetch>();

const queuedJob: Job = {
  company: "Acme",
  role: "Software Engineer Intern",
  link: "https://job-boards.greenhouse.io/acme/jobs/1",
  location: "Austin, TX",
};

const newJob: Job = {
  company: "Globex",
  role: "Software Engineer Intern",
  link: "https://job-boards.greenhouse.io/globex/jobs/2",
  location: "Seattle, WA",
};

describe("batch queue while AI is disabled", () => {
  beforeEach(async () => {
    await fs.rm(tmp.dir, { recursive: true, force: true });
    ai.created.length = 0;
    ai.generate.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    dataMocks.loadOpportunities.mockReset().mockResolvedValue([]);
    dataMocks.saveOpportunities.mockReset().mockResolvedValue(undefined);
    dataMocks.saveJob.mockReset().mockResolvedValue(undefined);
    dataMocks.saveUrls.mockReset().mockResolvedValue(undefined);
    buildCompanyListMock.mockReset().mockResolvedValue(undefined);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await fs.rm(tmp.dir, { recursive: true, force: true });

    for (const [key, value] of Object.entries(env.original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("queues new batch jobs on ingest and keeps the queue for when AI is enabled again", async () => {
    expect(process.env.AI_MODE).toBeUndefined();
    expect(Posting.from(newJob).shouldBatchAnalyze()).toBe(true);

    await saveBatchQueue([queuedJob]);

    const urls = new Set<string>();
    const keys = new Set<string>();
    const ingest = await processJobs({ jobs: [newJob], urls, keys, currentId: 0 });

    expect(ingest).toMatchObject({ batched: 1, failed: 0, skipped: 0, count: 0 });
    expect(urls).toEqual(new Set([newJob.link]));
    expect(keys).toEqual(new Set([Posting.from(newJob).key()]));
    expect(dataMocks.saveUrls).toHaveBeenCalledWith(new Set([newJob.link]));
    expect(dataMocks.saveOpportunities).toHaveBeenCalledWith([
      expect.objectContaining({ link: newJob.link }),
    ]);
    expect(await loadBatchQueue()).toEqual([queuedJob, newJob]);

    const submit = await submitQueuedJobs();

    expect(submit).toEqual({ submitted: 0, analyzed: [] });
    expect(await loadBatchQueue()).toEqual([queuedJob, newJob]);
    expect(await loadInflightBatches()).toEqual([]);
    expect(ai.created).toEqual([]);
    expect(ai.generate).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
