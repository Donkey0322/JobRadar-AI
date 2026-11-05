import pLimit from "p-limit";

import { RED_CROSS } from "@/constants/log";

import type { JD, Job } from "@/types";
import type {
  AIResponse,
  BatchGenerateRequest,
  BatchGenerateResult,
  BatchJobStatus,
} from "@/utils/ai/provider/utils";

import { getJobKey } from "@/modules/ats/job-key";
import analyzeJD, {
  analyzeQualifications,
  formatJDPrompt,
  formatQualificationPrompt,
  getAnalyzeJDConfig,
  getQualificationConfig,
} from "@/modules/posting/analysis/ai";
import {
  jdResponseSpilled,
  parseAIJDResult,
  parseQualificationResult,
} from "@/modules/posting/analysis/response";
import { isRetryableJDFetch, JD_FETCH_OK } from "@/modules/posting/jd";
import { Posting } from "@/modules/posting/posting";
import { batchInflight, batchQueue } from "@/store/batch";
import { AI_DEFAULT_MODEL, getAIProvider } from "@/utils/ai";
import { isAIEnabled } from "@/utils/ai/enabled";
import { logger } from "@/utils/logger";

async function withQualifications(job: Job, jd: JD, rawJD: string, cost: number) {
  const posting = Posting.from(job).setJD(jd);
  const added = await posting.addQualifications(rawJD);

  return { jd: posting.jd ?? jd, cost: cost + added.cost };
}

async function retrySpilled(
  job: Job,
  analyze: (rawJD: string) => Promise<AIResponse>
): Promise<AIResponse | null> {
  logger.warn({ company: job.company, url: job.link }, "⚠️ AI response spilled; retrying once");

  const { jd: rawJD } = await Posting.from(job).getRawJD();

  if (!rawJD) {
    return null;
  }

  return analyze(rawJD);
}

export interface InflightBatch {
  name: string;
  submittedAt: string;
  phase?: "screen" | "qualifications";
  jobs: Job[];
  screenCosts?: Record<string, number>;
}

export interface AnalyzedBatchJob {
  job: Job;
  jd: JD;
  cost: number;
}

const BATCH_CHUNK_SIZE = 50;
const FETCH_CONCURRENCY = 10;

export async function loadBatchQueue(): Promise<Job[]> {
  return batchQueue.load();
}

export async function saveBatchQueue(jobs: Job[]) {
  await batchQueue.save(jobs);
}

export async function loadInflightBatches(): Promise<InflightBatch[]> {
  return batchInflight.load<InflightBatch>();
}

export async function saveInflightBatches(batches: InflightBatch[]) {
  await batchInflight.save(batches);
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
      ...(job.country ? { country: job.country } : {}),
    });
  }

  if (appended.length === 0) {
    return;
  }

  await saveBatchQueue([...queued, ...appended]);

  logger.info({ count: appended.length }, "📦 Queued jobs for batch analysis");
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

function batchPhase(batch: InflightBatch) {
  return batch.phase ?? "screen";
}

/**
 * Pair provider results to batch jobs. A valid key wins. An unmatched result
 * may use its index only when that job is still free. A result is never
 * reassigned to a different job, and a job never receives a second result.
 */
function pairBatchResults(jobs: Job[], results: BatchGenerateResult[]) {
  const jobsByKey = new Map<string, Job>();

  for (const job of jobs) {
    const key = getJobKey(job.link);

    if (!jobsByKey.has(key)) {
      jobsByKey.set(key, job);
    }
  }

  const pairedJobKeys = new Set<string>();
  const claimed = new Set<number>();
  const pairs: Array<{ job: Job; result: BatchGenerateResult; resultIndex: number }> = [];
  const skipped: Array<{ index: number; key: string; reason: string }> = [];

  for (const [index, result] of results.entries()) {
    const job = result.key ? jobsByKey.get(result.key) : undefined;

    if (!job) {
      continue;
    }

    const key = getJobKey(job.link);

    if (pairedJobKeys.has(key)) {
      skipped.push({ index, key: result.key, reason: "duplicate key; job already paired" });
      claimed.add(index);
      continue;
    }

    pairedJobKeys.add(key);
    claimed.add(index);
    pairs.push({ job, result, resultIndex: index });
  }

  for (const [index, result] of results.entries()) {
    if (claimed.has(index)) {
      continue;
    }

    const job = jobs[index];

    if (!job) {
      skipped.push({
        index,
        key: result.key,
        reason: "key did not match a job and the index is outside the batch",
      });
      continue;
    }

    const key = getJobKey(job.link);

    if (pairedJobKeys.has(key)) {
      skipped.push({
        index,
        key: result.key,
        reason: "index points at a job that already has a result",
      });
      continue;
    }

    pairedJobKeys.add(key);
    claimed.add(index);
    pairs.push({ job, result, resultIndex: index });
  }

  pairs.sort((left, right) => left.resultIndex - right.resultIndex);

  return { pairs, skipped, pairedJobKeys };
}

async function resolveAnalyzedResult(
  job: Job,
  result: string | null,
  cost: number
): Promise<AnalyzedBatchJob | null> {
  if (!result || !jdResponseSpilled(result)) {
    return parseAnalyzedResult(job, result, cost);
  }

  const retry = await retrySpilled(job, (rawJD) => analyzeJD(rawJD, false, job.location));

  if (retry?.result) {
    return parseAnalyzedResult(job, retry.result, cost + retry.cost);
  }

  return parseAnalyzedResult(job, result, cost);
}

async function resolveQualificationResult(
  job: Job,
  result: string | null,
  cost: number
): Promise<AnalyzedBatchJob | null> {
  const screen = job.jd;

  if (!screen) {
    return null;
  }

  const spilled = Boolean(result && jdResponseSpilled(result));
  let qualifications = result && !spilled ? parseQualificationResult(result) : null;
  let totalCost = cost;

  if (!qualifications) {
    if (spilled) {
      const retry = await retrySpilled(job, (rawJD) => analyzeQualifications(rawJD, false));

      if (retry) {
        totalCost += retry.cost;
        qualifications = retry.result ? parseQualificationResult(retry.result) : null;
      }
    } else {
      const { jd: rawJD } = await Posting.from(job).getRawJD();

      if (rawJD) {
        const retry = await analyzeQualifications(rawJD, false);
        totalCost += retry.cost;
        qualifications = retry.result ? parseQualificationResult(retry.result) : null;
      }
    }
  }

  if (!qualifications) {
    return { job, jd: screen, cost: totalCost };
  }

  return {
    job,
    jd: { ...screen, qualifications },
    cost: totalCost,
  };
}

async function submitQualificationBatches(
  pending: Array<{ job: Job; jd: JD; cost: number }>
): Promise<{ analyzed: AnalyzedBatchJob[]; inflight: InflightBatch[] }> {
  if (pending.length === 0) {
    return { analyzed: [], inflight: [] };
  }

  const provider = getAIProvider();
  const fetchLimit = pLimit(FETCH_CONCURRENCY);
  const ready: Array<{ job: Job; jd: JD; cost: number; rawJD: string }> = [];
  const analyzed: AnalyzedBatchJob[] = [];
  const requeue: Job[] = [];

  const fetched = await Promise.all(
    pending.map((item) =>
      fetchLimit(async () => {
        const { jd: rawJD, error } = await Posting.from(item.job).getRawJD();
        return { ...item, rawJD, error };
      })
    )
  );

  for (const item of fetched) {
    if (!item.rawJD) {
      if (isRetryableJDFetch(item.error)) {
        requeue.push(item.job);
      } else {
        analyzed.push({ job: item.job, jd: item.jd, cost: item.cost });
      }
      continue;
    }

    ready.push({
      job: item.job,
      jd: item.jd,
      cost: item.cost,
      rawJD: item.rawJD,
    });
  }

  if (requeue.length > 0) {
    await enqueueBatchJobs(requeue);
  }

  if (ready.length === 0 || !provider?.submitBatch) {
    for (const item of ready) {
      const finished = await withQualifications(item.job, item.jd, item.rawJD, item.cost);
      analyzed.push({ job: item.job, jd: finished.jd, cost: finished.cost });
    }

    return { analyzed, inflight: [] };
  }

  const { schema, systemInstruction } = await getQualificationConfig();
  const inflight: InflightBatch[] = [];

  for (let offset = 0; offset < ready.length; offset += BATCH_CHUNK_SIZE) {
    const chunk = ready.slice(offset, offset + BATCH_CHUNK_SIZE);
    const requests: BatchGenerateRequest[] = chunk.map((item) => ({
      key: getJobKey(item.job.link),
      prompt: formatQualificationPrompt(item.rawJD),
      schema,
      systemInstruction,
    }));
    const submitted = await provider.submitBatch(requests, AI_DEFAULT_MODEL);

    if (!submitted) {
      for (const item of chunk) {
        const finished = await withQualifications(item.job, item.jd, item.rawJD, item.cost);
        analyzed.push({ job: item.job, jd: finished.jd, cost: finished.cost });
      }
      continue;
    }

    const screenCosts: Record<string, number> = {};

    for (const item of chunk) {
      screenCosts[getJobKey(item.job.link)] = item.cost;
    }

    const qualificationBatch: InflightBatch = {
      name: submitted.name,
      submittedAt: new Date().toISOString(),
      phase: "qualifications",
      jobs: chunk.map((item) => ({ ...item.job, jd: item.jd })),
      screenCosts,
    };
    // The provider already accepted this id. Append it before returning so a
    // later persistence failure can still collect this batch. The source
    // screen batch stays in the file until jobs and opportunities persist.
    await rememberQualificationBatch(qualificationBatch);
    inflight.push(qualificationBatch);

    logger.info({ name: submitted.name, count: chunk.length }, "📦 Submitted qualification batch");
  }

  return { analyzed, inflight };
}

async function rememberQualificationBatch(batch: InflightBatch) {
  const current = await loadInflightBatches();

  if (current.some((item) => item.name === batch.name)) {
    return;
  }

  await saveInflightBatches([...current, batch]);
}

async function analyzeJobsRealtime(jobs: Array<{ job: Job; rawJD: string }>) {
  const analyzed: AnalyzedBatchJob[] = [];

  for (const { job, rawJD } of jobs) {
    const posting = Posting.from(job);
    const result = await posting.analyze({
      fetched: { jd: rawJD, error: JD_FETCH_OK },
    });

    if (!result.jd) {
      continue;
    }

    analyzed.push({ job, jd: result.jd, cost: result.cost });
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
  const pendingQualifications: Array<{ job: Job; jd: JD; cost: number }> = [];
  const completedDurations: number[] = [];
  const statuses = new Map<string, BatchJobStatus>();

  for (const batch of inflight) {
    statuses.set(batch.name, await provider.getBatch(batch.name));
  }

  // Pending and succeeded qualification batches already track their jobs.
  // A failed batch must not submit another copy of a job those batches cover.
  const coveredQualificationKeys = new Set<string>();

  for (const batch of inflight) {
    if (batchPhase(batch) !== "qualifications" || statuses.get(batch.name)?.state === "failed") {
      continue;
    }

    for (const job of batch.jobs) {
      coveredQualificationKeys.add(getJobKey(job.link));
    }
  }

  for (const batch of inflight) {
    const status = statuses.get(batch.name);

    if (!status || status.state === "pending") {
      remaining.push(batch);
      continue;
    }

    if (status.state === "failed") {
      logger.error(
        { name: batch.name, error: status.error, count: batch.jobs.length },
        `${RED_CROSS} Batch job failed; re-queuing`
      );

      if (batchPhase(batch) === "qualifications") {
        for (const job of batch.jobs) {
          const key = getJobKey(job.link);

          if (coveredQualificationKeys.has(key)) {
            continue;
          }

          if (job.jd) {
            pendingQualifications.push({
              job,
              jd: job.jd,
              cost: batch.screenCosts?.[key] ?? 0,
            });
            coveredQualificationKeys.add(key);
          } else {
            requeue.push(job);
          }
        }
      } else {
        requeue.push(...batch.jobs);
      }
      continue;
    }

    const durationMs = status.durationMs ?? durationFromSubmittedAt(batch.submittedAt);

    if (durationMs !== undefined) {
      completedDurations.push(durationMs);
    }

    const { pairs, skipped, pairedJobKeys } = pairBatchResults(batch.jobs, status.results);

    for (const skip of skipped) {
      logger.warn(
        { name: batch.name, index: skip.index, key: skip.key, reason: skip.reason },
        "⚠️ Batch result was not paired"
      );
    }

    for (const { job, result } of pairs) {
      const key = getJobKey(job.link);

      if (result.error && !result.result) {
        logger.warn(
          { company: job.company, url: job.link, error: result.error },
          "⚠️ Batch request failed"
        );
        requeue.push(job);
        continue;
      }

      if (batchPhase(batch) === "qualifications") {
        const parsed = await resolveQualificationResult(job, result.result, result.cost);

        if (parsed) {
          analyzed.push({
            ...parsed,
            cost: parsed.cost + (batch.screenCosts?.[key] ?? 0),
          });
          continue;
        }
      } else {
        const parsed = await resolveAnalyzedResult(job, result.result, result.cost);
        const posting = Posting.from(job);

        if (parsed) posting.setJD(parsed.jd);

        if (parsed && posting.needsQualifications()) {
          if (!coveredQualificationKeys.has(key)) {
            pendingQualifications.push({ job, jd: parsed.jd, cost: parsed.cost });
            coveredQualificationKeys.add(key);
          }
          continue;
        }

        if (parsed) {
          analyzed.push(parsed);
          continue;
        }
      }

      logger.warn(
        { company: job.company, url: job.link },
        "⚠️ Batch result missing or unparseable; re-queuing"
      );
      requeue.push(job);
    }

    for (const job of batch.jobs) {
      if (!pairedJobKeys.has(getJobKey(job.link))) {
        requeue.push(job);
      }
    }
  }

  if (requeue.length > 0) {
    await enqueueBatchJobs(requeue);
  }

  const qualificationBatch = await submitQualificationBatches(pendingQualifications);
  analyzed.push(...qualificationBatch.analyzed);
  remaining.push(...qualificationBatch.inflight);

  // inflight.json is a JSON array of { name, submittedAt, phase?, jobs, screenCosts? }.
  // A qualification id is appended as soon as rename of that file succeeds.
  // The file is replaced with the still-pending batches only after jobs and
  // opportunities both persist. A provider id that is not in the file yet
  // cannot be discovered on the next run.
  if (analyzed.length === 0) {
    await saveInflightBatches(remaining);
  } else {
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

  if (!isAIEnabled()) {
    logger.info("📦 AI is disabled; leaving batch queue untouched");
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
        const { jd: rawJD, error } = await Posting.from(job).getRawJD();
        return { job, rawJD, error };
      })
    )
  );

  for (const { job, rawJD, error } of fetchResults) {
    if (!rawJD) {
      if (isRetryableJDFetch(error)) {
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
    prompt: formatJDPrompt(rawJD, job.location),
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
    phase: "screen",
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
