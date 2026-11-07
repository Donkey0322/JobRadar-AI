import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as StorePaths from "@/store/paths";
import type { Job } from "@/types";
import type * as AI from "@/utils/ai";

const paths = await vi.hoisted(async () => {
  const nodeOs = await import("node:os");
  const nodePath = await import("node:path");
  const { mkdtemp } = await import("node:fs/promises");

  return { root: await mkdtemp(nodePath.join(nodeOs.tmpdir(), "jobradar-fetch-retry-")) };
});

const provider = vi.hoisted(() => ({
  batchApi: true,
  submitBatch: vi.fn(async () => ({ name: "batches/fetch" })),
  getBatch: vi.fn(),
}));

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
    getAIProvider: () => ({
      generate: vi.fn(),
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

import { CONFIG } from "@/config";
import { loadBatchQueue, retryFailedBatchJobs, submitQueuedJobs } from "@/modules/posting/batch";
import { BatchFailures } from "@/modules/posting/batch/failures";
import { HttpStatusCode, JD_FETCH_ERROR, JD_FETCH_OK } from "@/modules/posting/jd";
import { Posting } from "@/modules/posting/posting";
import { saveBatchQueue } from "@/store/batch";
import { opportunities } from "@/store/opportunities";

const ai = CONFIG.ai;
const aiMode = process.env.AI_MODE;
const dirs: string[] = [];

function listing(id: string): Job {
  return {
    company: "Acme",
    role: "Software Engineer",
    link: `https://job-boards.greenhouse.io/acme/jobs/${id}`,
    location: "Austin, TX",
  };
}

async function failures() {
  return BatchFailures.load();
}

async function opportunity(link: string) {
  return (await opportunities.load()).find((row) => row.link === link);
}

describe("persistent JD fetch retries", () => {
  let fetchJD: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    paths.root = await mkdtemp(path.join(tmpdir(), "jobradar-fetch-retry-"));
    dirs.push(paths.root);
    CONFIG.ai = ai.enabled ? ai : { enabled: true, provider: "openai", model: "test" };
    delete process.env.AI_MODE;
    process.env.AI_API_KEY = "test-fake-ai-key";
    provider.batchApi = true;
    provider.submitBatch.mockClear();
    provider.submitBatch.mockResolvedValue({ name: "batches/fetch" });
    fetchJD = vi.spyOn(Posting.prototype, "getRawJD");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-07T12:00:00.000Z"));
  });

  afterEach(async () => {
    CONFIG.ai = ai;
    if (aiMode === undefined) delete process.env.AI_MODE;
    else process.env.AI_MODE = aiMode;
    vi.useRealTimers();
    vi.restoreAllMocks();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("retries a 503 and then a 429 only after Retry-After", async () => {
    const job = listing("501");
    await saveBatchQueue([job]);
    fetchJD.mockResolvedValueOnce({
      jd: null,
      error: JD_FETCH_ERROR.http(HttpStatusCode.SERVICE_UNAVAILABLE, "unavailable"),
    });

    await submitQueuedJobs();

    expect(fetchJD).toHaveBeenCalledTimes(1);
    let saved = await failures();
    expect(saved.get(job)?.status).toBe("retrying");
    expect(saved.get(job)?.attempts).toHaveLength(1);
    expect(saved.get(job)?.attempts[0]?.id).toMatch(/^fetch:/);
    expect(saved.get(job)?.nextAttemptAt).toBeUndefined();

    fetchJD.mockResolvedValueOnce({
      jd: null,
      error: JD_FETCH_ERROR.http(HttpStatusCode.TOO_MANY_REQUESTS, "slow down", 30_000),
    });
    await submitQueuedJobs();
    saved = await failures();
    expect(saved.get(job)?.attempts).toHaveLength(2);
    expect(saved.get(job)?.nextAttemptAt).toBe("2026-11-07T12:00:30.000Z");

    vi.setSystemTime(new Date("2026-11-07T12:00:29.000Z"));
    await submitQueuedJobs();
    expect(fetchJD).toHaveBeenCalledTimes(2);
    expect((await failures()).get(job)?.attempts).toHaveLength(2);

    vi.setSystemTime(new Date("2026-11-07T12:00:30.000Z"));
    fetchJD.mockResolvedValueOnce({ jd: "raw jd", error: JD_FETCH_OK });
    const submitted = await submitQueuedJobs();

    expect(submitted.submitted).toBe(1);
    expect(fetchJD).toHaveBeenCalledTimes(3);
    expect((await failures()).get(job)?.attempts).toHaveLength(2);
    expect(provider.submitBatch).toHaveBeenCalledTimes(1);
    expect(await opportunity(job.link)).toBeUndefined();
  });

  it("stops after the shared attempt budget and lets a manual retry start a new round", async () => {
    const job = listing("503");
    await saveBatchQueue([job]);
    fetchJD.mockResolvedValue({
      jd: null,
      error: JD_FETCH_ERROR.http(HttpStatusCode.SERVICE_UNAVAILABLE, "unavailable"),
    });

    await submitQueuedJobs();
    await submitQueuedJobs();
    await submitQueuedJobs();

    const stopped = await failures();
    expect(stopped.get(job)?.status).toBe("failed");
    expect(stopped.get(job)?.attempts).toHaveLength(3);
    expect(new Set(stopped.get(job)?.attempts.map((item) => item.id)).size).toBe(3);
    const row = await opportunity(job.link);
    expect(row?.stop).toMatchObject({ reason: "exhausted", code: 503 });
    expect(row?.expired).toBe(false);
    expect(await loadBatchQueue()).toEqual([]);

    await submitQueuedJobs();
    expect(fetchJD).toHaveBeenCalledTimes(3);

    expect(await retryFailedBatchJobs()).toBe(1);
    const retried = await failures();
    expect(retried.get(job)?.status).toBe("retrying");
    expect(retried.get(job)?.manualRetries).toBe(1);
    expect(retried.get(job)?.nextAttemptAt).toBeUndefined();
    expect(await loadBatchQueue()).toEqual([expect.objectContaining({ link: job.link })]);

    await submitQueuedJobs();
    const again = (await failures()).get(job);
    expect(again?.attempts.filter((item) => item.round === 1)).toHaveLength(1);
    expect(again?.status).toBe("retrying");
    expect(fetchJD).toHaveBeenCalledTimes(4);
  });

  it("marks an explicit 404 or 410 expired and leaves a synthetic 404 and a 403 open", async () => {
    const gone = listing("404");
    const closed = listing("405");
    const forbidden = listing("406");
    const removed = listing("410");
    await saveBatchQueue([gone, closed, forbidden, removed]);
    fetchJD.mockImplementation(async function (this: Posting) {
      if (this.link === gone.link) {
        return { jd: null, error: JD_FETCH_ERROR.http(HttpStatusCode.NOT_FOUND, "Not Found") };
      }

      if (this.link === removed.link) {
        return { jd: null, error: JD_FETCH_ERROR.http(HttpStatusCode.GONE, "Gone") };
      }

      if (this.link === forbidden.link) {
        return { jd: null, error: JD_FETCH_ERROR.http(HttpStatusCode.FORBIDDEN, "Forbidden") };
      }

      return { jd: null, error: JD_FETCH_ERROR.noData() };
    });

    await submitQueuedJobs();
    await submitQueuedJobs();

    expect(fetchJD).toHaveBeenCalledTimes(4);
    expect((await opportunity(gone.link))?.expired).toBe(true);
    expect((await opportunity(gone.link))?.stop).toEqual({
      reason: "gone",
      code: 404,
      at: "2026-11-07T12:00:00.000Z",
    });
    expect((await opportunity(removed.link))?.stop?.reason).toBe("gone");
    expect((await opportunity(removed.link))?.expired).toBe(true);
    expect((await opportunity(closed.link))?.expired).toBe(false);
    expect((await opportunity(closed.link))?.stop).toMatchObject({
      reason: "undetermined",
      code: 404,
      failure: "closed",
    });
    expect((await opportunity(forbidden.link))?.expired).toBe(false);
    expect((await opportunity(forbidden.link))?.stop).toMatchObject({
      reason: "undetermined",
      code: 403,
    });
    expect(await loadBatchQueue()).toEqual([]);
  });

  it("keeps the queued job when the stop cannot be saved, then settles it without another fetch", async () => {
    const job = listing("407");
    await saveBatchQueue([job]);
    fetchJD.mockResolvedValue({
      jd: null,
      error: JD_FETCH_ERROR.http(HttpStatusCode.NOT_FOUND, "Not Found"),
    });
    const replace = vi
      .spyOn(opportunities, "replace")
      .mockRejectedValueOnce(new Error("disk full"));

    await expect(submitQueuedJobs()).resolves.toEqual({ submitted: 0, analyzed: [] });

    expect((await loadBatchQueue()).map((item) => item.link)).toEqual([job.link]);
    expect((await failures()).get(job)?.attempts).toHaveLength(1);
    expect(await opportunity(job.link)).toBeUndefined();

    replace.mockRestore();
    await submitQueuedJobs();

    expect(fetchJD).toHaveBeenCalledTimes(1);
    expect((await failures()).get(job)?.attempts).toHaveLength(1);
    expect((await opportunity(job.link))?.stop?.reason).toBe("gone");
    expect(await loadBatchQueue()).toEqual([]);
  });

  it("counts a later AI failure against the attempts already used by fetches", async () => {
    const job = listing("508");
    await saveBatchQueue([job]);
    provider.batchApi = false;
    fetchJD
      .mockResolvedValueOnce({
        jd: null,
        error: JD_FETCH_ERROR.fetch("socket hang up"),
      })
      .mockResolvedValueOnce({
        jd: null,
        error: JD_FETCH_ERROR.fetch("timed out", "timeout"),
      })
      .mockResolvedValueOnce({ jd: "raw jd", error: JD_FETCH_OK });
    vi.spyOn(Posting.prototype, "analyze").mockResolvedValue({
      jd: null,
      rawJD: "raw jd",
      cost: 0.02,
      error: JD_FETCH_OK,
      failure: { stage: "ai", reason: "empty" },
    });

    await submitQueuedJobs();
    await submitQueuedJobs();
    await submitQueuedJobs();

    const record = (await failures()).get(job);
    expect(record?.status).toBe("failed");
    expect(record?.attempts.map((item) => item.failure.stage)).toEqual(["fetch", "fetch", "ai"]);
    expect(await opportunity(job.link)).toBeUndefined();
    const calls = fetchJD.mock.calls.length;
    await submitQueuedJobs();
    expect(fetchJD).toHaveBeenCalledTimes(calls);
  });

  it("keeps retrying a 5xx after fetchPostingJD also fails to read the HTML page", async () => {
    fetchJD.mockRestore();
    const job = listing("503");
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return new Response("", { status: 503, statusText: "Service Unavailable" });
      })
    );
    await saveBatchQueue([job]);

    await submitQueuedJobs();
    await submitQueuedJobs();
    await submitQueuedJobs();

    expect(calls.filter((url) => url.includes("boards-api.greenhouse.io"))).toHaveLength(3);
    expect(calls.filter((url) => url === job.link)).toHaveLength(3);
    const saved = await failures();
    expect(saved.get(job)?.status).toBe("failed");
    expect(saved.get(job)?.attempts).toHaveLength(3);
    expect((await opportunity(job.link))?.stop).toMatchObject({ reason: "exhausted", code: 503 });
    expect((await opportunity(job.link))?.expired).toBe(false);

    await submitQueuedJobs();
    expect(calls).toHaveLength(6);
    expect(provider.submitBatch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
