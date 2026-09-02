import { promises as fs } from "node:fs";
import path from "node:path";
import pLimit from "p-limit";

import { BATCH_INFLIGHT_PATH, BATCH_QUEUE_PATH } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { JD, Job } from "@/types";
import type { BatchGenerateRequest } from "@/utils/ai/provider/utils";

import analyzeJD, { formatJDPrompt, getAnalyzeJDConfig } from "./ai";
import { parseAIJDResult } from "./response";

import { HttpStatusCode, NETWORK_ERROR_CODE } from "@/modules/ats/detail";
import { getRawJD } from "@/modules/job-analysis";
import { AI_DEFAULT_MODEL, getAIProvider } from "@/utils/ai";
import { readJsonFile } from "@/utils/data";
import { getJobKey } from "@/utils/job-key";
import { logger } from "@/utils/logger";
import { readNdjsonFileIfExists } from "@/utils/ndjson-archive";

export interface InflightBatch {
  name: string;
  submittedAt: string;
  jobs: Job[];
}

export interface AnalyzedBatchJob {
  job: Job;
  jd: JD;
  cost: number;
}

const BATCH_CHUNK_SIZE = 50;
const FETCH_CONCURRENCY = 10;

function toNdjson(records: unknown[]) {
  if (records.length === 0) {
    return "";
  }

  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

export async function loadBatchQueue(): Promise<Job[]> {
  return await readNdjsonFileIfExists<Job>(BATCH_QUEUE_PATH);
}

export async function saveBatchQueue(jobs: Job[]) {
  await fs.mkdir(path.dirname(BATCH_QUEUE_PATH), { recursive: true });
  await fs.writeFile(BATCH_QUEUE_PATH, toNdjson(jobs), "utf-8");
}

export async function loadInflightBatches(): Promise<InflightBatch[]> {
  try {
    return await readJsonFile<InflightBatch[]>(BATCH_INFLIGHT_PATH);
  } catch {
    return [];
  }
}

export async function saveInflightBatches(batches: InflightBatch[]) {
  await fs.mkdir(path.dirname(BATCH_INFLIGHT_PATH), { recursive: true });
  await fs.writeFile(BATCH_INFLIGHT_PATH, `${JSON.stringify(batches, null, 2)}\n`, "utf-8");
}

export async function enqueueBatchJobs(jobs: Job[]) {
  if (jobs.length === 0) {
    return;
  }

  const queued = await loadBatchQueue();
  const seen = new Set(queued.map((job) => getJobKey(job.link)));
  const appended: Job[] = [];

  for (const job of jobs) {
    const key = getJobKey(job.link);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    appended.push({
      company: job.company,
      role: job.role,
      link: job.link,
      location: job.location,
    });
  }

  if (appended.length === 0) {
    return;
  }

  await saveBatchQueue([...queued, ...appended]);

  logger.info({ count: appended.length }, "📦 Queued jobs for batch analysis");
}

function isRetryableFetch(code: number) {
  return code === NETWORK_ERROR_CODE || code === HttpStatusCode.TOO_MANY_REQUESTS;
}

function parseAnalyzedResult(
  job: Job,
  result: string | null,
  cost: number
): AnalyzedBatchJob | null {
  if (!result) {
    return null;
  }

  const parsed = parseAIJDResult(result);

  if (parsed.status !== "ok") {
    logger.warn(
      {
        company: job.company,
        url: job.link,
        status: parsed.status,
        err: parsed.error,
      },
      "⚠️ Invalid batch AI response"
    );
    return null;
  }

  return { job, jd: parsed.jd, cost };
}

async function analyzeJobsRealtime(jobs: Array<{ job: Job; rawJD: string }>) {
  const analyzed: AnalyzedBatchJob[] = [];

  for (const { job, rawJD } of jobs) {
    const { result, cost } = await analyzeJD(rawJD);
    const parsed = parseAnalyzedResult(job, result, cost);

    if (parsed) {
      analyzed.push(parsed);
    }
  }

  return analyzed;
}

export async function collectInflightBatches(): Promise<{
  analyzed: AnalyzedBatchJob[];
  remaining: InflightBatch[];
  completedDurationMs: number | null;
}> {
  const inflight = await loadInflightBatches();

  if (inflight.length === 0) {
    return { analyzed: [], remaining: [], completedDurationMs: null };
  }

  const provider = getAIProvider();

  if (!provider?.getBatch) {
    logger.warn("⚠️ Current AI provider cannot collect batch jobs; re-queuing inflight jobs");
    await enqueueBatchJobs(inflight.flatMap((batch) => batch.jobs));
    await saveInflightBatches([]);
    return { analyzed: [], remaining: [], completedDurationMs: null };
  }

  const analyzed: AnalyzedBatchJob[] = [];
  const remaining: InflightBatch[] = [];
  const requeue: Job[] = [];
  const completedDurations: number[] = [];

  for (const batch of inflight) {
    const status = await provider.getBatch(batch.name);

    if (status.state === "pending") {
      remaining.push(batch);
      continue;
    }

    if (status.state === "failed") {
      logger.error(
        { name: batch.name, error: status.error, count: batch.jobs.length },
        `${RED_CROSS} Batch job failed; re-queuing`
      );
      requeue.push(...batch.jobs);
      continue;
    }

    const durationMs = status.durationMs ?? durationFromSubmittedAt(batch.submittedAt);

    if (durationMs !== undefined) {
      completedDurations.push(durationMs);
    }

    const jobsByKey = new Map(batch.jobs.map((job) => [getJobKey(job.link), job]));
    const handled = new Set<string>();

    status.results.forEach((result, index) => {
      const job = jobsByKey.get(result.key) ?? batch.jobs[index];

      if (!job) {
        return;
      }

      const key = getJobKey(job.link);
      handled.add(key);

      if (result.error && !result.result) {
        logger.warn(
          { company: job.company, url: job.link, error: result.error },
          "⚠️ Batch request failed"
        );
        requeue.push(job);
        return;
      }

      const parsed = parseAnalyzedResult(job, result.result, result.cost);

      if (parsed) {
        analyzed.push(parsed);
        return;
      }

      logger.warn(
        { company: job.company, url: job.link },
        "⚠️ Batch result missing or unparseable; re-queuing"
      );
      requeue.push(job);
    });

    for (const job of batch.jobs) {
      if (!handled.has(getJobKey(job.link))) {
        requeue.push(job);
      }
    }
  }

  if (requeue.length > 0) {
    await enqueueBatchJobs(requeue);
  }

  await saveInflightBatches(remaining);

  if (analyzed.length > 0) {
    logger.info({ count: analyzed.length }, "📦 Collected batch analysis results");
  }

  return {
    analyzed,
    remaining,
    completedDurationMs: completedDurations.length > 0 ? Math.max(...completedDurations) : null,
  };
}

function durationFromSubmittedAt(submittedAt: string) {
  const started = Date.parse(submittedAt);

  if (!Number.isFinite(started)) {
    return undefined;
  }

  return Math.max(0, Date.now() - started);
}

export async function submitQueuedJobs(limit = Number.POSITIVE_INFINITY): Promise<{
  submitted: number;
  analyzed: AnalyzedBatchJob[];
}> {
  const queue = await loadBatchQueue();

  if (queue.length === 0 || limit <= 0) {
    return { submitted: 0, analyzed: [] };
  }

  if (process.env.AI_MODE === "DOWN") {
    logger.info("📦 AI_MODE is DOWN; leaving batch queue untouched");
    return { submitted: 0, analyzed: [] };
  }

  const provider = getAIProvider();
  const chunk = queue.slice(0, Math.min(BATCH_CHUNK_SIZE, limit));
  const fetchLimit = pLimit(FETCH_CONCURRENCY);
  const retry: Job[] = [];
  const fetched: Array<{ job: Job; rawJD: string }> = [];

  const fetchResults = await Promise.all(
    chunk.map((job) =>
      fetchLimit(async () => {
        const { jd: rawJD, error } = await getRawJD(job.link);
        return { job, rawJD, error };
      })
    )
  );

  for (const { job, rawJD, error } of fetchResults) {
    if (!rawJD) {
      if (isRetryableFetch(error.code)) {
        retry.push(job);
      } else {
        logger.warn(
          {
            company: job.company,
            url: job.link,
            code: error.code,
          },
          "⏭️ Dropping batch job after JD fetch failure"
        );
      }
      continue;
    }

    fetched.push({ job, rawJD });
  }

  const leftover = [...retry, ...queue.slice(chunk.length)];

  if (fetched.length === 0) {
    await saveBatchQueue(leftover);
    return { submitted: 0, analyzed: [] };
  }

  if (!provider?.submitBatch || !provider.getBatch) {
    logger.warn("⚠️ Current AI provider has no Batch API; analyzing queued jobs in real time");
    const analyzed = await analyzeJobsRealtime(fetched);
    await saveBatchQueue(leftover);
    return { submitted: 0, analyzed };
  }

  const { schema, systemInstruction } = await getAnalyzeJDConfig();
  const requests: BatchGenerateRequest[] = fetched.map(({ job, rawJD }) => ({
    key: getJobKey(job.link),
    prompt: formatJDPrompt(rawJD),
    schema,
    systemInstruction,
  }));

  const submitted = await provider.submitBatch(requests, AI_DEFAULT_MODEL);

  if (!submitted) {
    await saveBatchQueue([...fetched.map(({ job }) => job), ...leftover]);
    return { submitted: 0, analyzed: [] };
  }

  const inflight = await loadInflightBatches();
  inflight.push({
    name: submitted.name,
    submittedAt: new Date().toISOString(),
    jobs: fetched.map(({ job }) => job),
  });
  await saveInflightBatches(inflight);
  await saveBatchQueue(leftover);

  logger.info(
    { name: submitted.name, count: fetched.length, remaining: leftover.length },
    "📦 Submitted jobs to the cheaper batch API"
  );

  return { submitted: fetched.length, analyzed: [] };
}
