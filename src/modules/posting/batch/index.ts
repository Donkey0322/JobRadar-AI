import { randomUUID } from "node:crypto";
import pLimit from "p-limit";

import { RED_CROSS } from "@/constants/log";

import type { BatchFailure } from "@/modules/posting/batch/failures";
import type { JD, Job } from "@/types";
import type {
  AIResponse,
  BatchGenerateRequest,
  BatchGenerateResult,
  BatchJobStatus,
} from "@/utils/ai/provider/utils";

import { getJobKey } from "@/modules/ats/job-key";
import { saveOpportunityStop, terminalOpportunityStop } from "@/modules/opportunity/stop";
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
import {
  BATCH_MAX_ATTEMPTS,
  BatchFailures,
  roundAttempts,
  toQueuedJob,
} from "@/modules/posting/batch/failures";
import { PendingResults } from "@/modules/posting/batch/results";
import { isTemporaryJDFetch, JD_FETCH_OK } from "@/modules/posting/jd";
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
    appended.push(toQueuedJob(job));
  }

  if (appended.length === 0) {
    return;
  }

  await saveBatchQueue([...queued, ...appended]);

  logger.info({ count: appended.length }, "📦 Queued jobs for batch analysis");
}

/** A model answer that breaks the JD rules. It counts toward `BATCH_MAX_ATTEMPTS`. */
interface InvalidBatchResult {
  invalid: true;
  cost: number;
}

type BatchParseResult = AnalyzedBatchJob | InvalidBatchResult | null;

function isInvalidResult(result: BatchParseResult): result is InvalidBatchResult {
  return result !== null && "invalid" in result;
}

function parseAnalyzedResult(job: Job, result: string | null, cost: number): BatchParseResult {
  if (!result) {
    return null;
  }

  const parsed = parseAIJDResult(result);

  if (parsed.status === "invalid") {
    logger.warn(
      { company: job.company, url: job.link, reason: "invalid", err: parsed.error },
      "⚠️ Batch AI response breaks the JD rules"
    );
    return { invalid: true, cost };
  }

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
): Promise<BatchParseResult> {
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
      if (isTemporaryJDFetch(item.error)) {
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

function logFailedAttempt(job: Job, record: BatchFailure) {
  const context = {
    company: job.company,
    url: job.link,
    failure: record.failure,
    attempts: roundAttempts(record).length,
    maxAttempts: BATCH_MAX_ATTEMPTS,
  };

  if (record.status === "retrying") {
    logger.warn(context, "⚠️ Batch analysis failed; keeping the job queued for another attempt");
  } else {
    logger.error(
      context,
      `${RED_CROSS} Batch analysis failed too many times; rerun with pnpm jobctl batch --retry-failed`
    );
  }
}

/**
 * Counts each invalid result once per provider batch and returns the `retrying` jobs to
 * re-queue. A result already counted, for example from an inflight batch collected again
 * after a manual retry, adds nothing but still re-queues a `retrying` job that has no
 * pending batch. failures.ndjson is saved before the caller re-queues jobs or drops the
 * inflight batch, so a failed save leaves that batch to be collected again.
 */
function stoppedByThisAttempt(
  before: BatchFailure["status"] | undefined,
  counted: boolean,
  after: BatchFailure["status"] | undefined
) {
  return counted && before !== "failed" && after === "failed";
}

async function recordInvalidResults(
  invalid: Array<{ job: Job; batch: string; cost: number }>,
  succeeded: Set<string>,
  pendingKeys: Set<string>
): Promise<{ jobs: Job[]; stopped: number }> {
  if (invalid.length === 0 && succeeded.size === 0) {
    return { jobs: [], stopped: 0 };
  }

  const failures = await BatchFailures.load();
  const retry: Job[] = [];
  const at = new Date().toISOString();
  let stopped = 0;

  for (const key of succeeded) {
    failures.clear(key);
  }

  for (const { job, batch, cost } of invalid) {
    const key = getJobKey(job.link);

    if (succeeded.has(key)) {
      continue;
    }

    const before = failures.get(job)?.status;
    const { record, counted } = failures.record(job, {
      id: batch,
      at,
      failure: { stage: "ai", reason: "invalid" },
      cost,
    });

    if (stoppedByThisAttempt(before, counted, record.status)) {
      stopped += 1;
    }

    if (counted) {
      logFailedAttempt(job, record);
    }

    if (record.status === "retrying" && !pendingKeys.has(key)) {
      retry.push(job);
    }
  }

  await failures.save();
  return { jobs: retry, stopped };
}

/**
 * Puts every failed job back in the queue with a fresh round of attempts, then the
 * normal batch run analyzes it. The queue is written first. If the record save fails,
 * the record stays `failed`, the next submit drops the queued copy, and running this
 * again picks the job up.
 */
export async function retryFailedBatchJobs(): Promise<number> {
  const failures = await BatchFailures.load();
  const failed = failures.failed();

  if (failed.length === 0) {
    return 0;
  }

  await enqueueBatchJobs(failed.map((record) => record.job));
  failures.markRetried(failed);
  await failures.save();
  return failed.length;
}

/**
 * Real-time JDs saved in results.ndjson that have not reached jobs and opportunities.
 * Persist them before analyzing anything new, then call `finishRealtimeJobs`.
 */
export async function loadRealtimeResults(): Promise<AnalyzedBatchJob[]> {
  const results = await PendingResults.load();
  return results.list().map(({ job, jd, cost }) => ({ job, jd, cost }));
}

/**
 * Call after real-time results persist to jobs and opportunities. Failure records go
 * first, then the queue, then results.ndjson. Until that last write, the saved result is
 * replayed, so an interruption at any step only repeats idempotent work.
 */
export async function finishRealtimeJobs(jobs: Job[]) {
  if (jobs.length === 0) {
    return;
  }

  const keys = new Set(jobs.map((job) => getJobKey(job.link)));
  const failures = await BatchFailures.load();

  for (const key of keys) {
    failures.clear(key);
  }

  await failures.save();
  const queue = await loadBatchQueue();
  const remaining = queue.filter((job) => !keys.has(getJobKey(job.link)));

  if (remaining.length !== queue.length) {
    await saveBatchQueue(remaining);
  }

  const results = await PendingResults.load();
  results.remove(keys);
  await results.save();
}

/**
 * Analyzes jobs one call at a time. A valid JD is saved to results.ndjson before it is
 * returned. Each failed call is a counted attempt. Returns the jobs that stay queued:
 * successes until `finishRealtimeJobs`, and `retrying` failures.
 */
async function analyzeJobsRealtime(
  jobs: Array<{ job: Job; rawJD: string }>,
  failures: BatchFailures,
  results: PendingResults
) {
  const analyzed: AnalyzedBatchJob[] = [];
  const kept: Job[] = [];
  let stopped = 0;

  for (const { job, rawJD } of jobs) {
    const posting = Posting.from(job);
    const result = await posting.analyze({
      fetched: { jd: rawJD, error: JD_FETCH_OK },
    });
    const attemptId = `realtime:${randomUUID()}`;

    if (result.jd) {
      results.add(job, {
        jd: result.jd,
        attemptId,
        cost: result.cost,
        analyzedAt: new Date().toISOString(),
      });

      try {
        await results.save();
      } catch (error) {
        logger.error(
          { company: job.company, url: job.link, attemptId, cost: result.cost, err: error },
          `${RED_CROSS} Could not save the real-time result; the job stays queued and the next run calls AI again`
        );
        throw error;
      }
      analyzed.push({ job, jd: result.jd, cost: result.cost });
      kept.push(job);
      continue;
    }

    const before = failures.get(job)?.status;
    const { record, counted } = failures.record(job, {
      id: attemptId,
      at: new Date().toISOString(),
      failure: result.failure ?? { stage: "ai", reason: "empty" },
      cost: result.cost,
    });

    if (stoppedByThisAttempt(before, counted, record.status)) {
      stopped += 1;
    }

    logFailedAttempt(job, record);

    if (record.status === "retrying") {
      kept.push(job);
    }
  }

  return { analyzed, kept, stopped };
}

export async function collectInflightBatches(): Promise<{
  analyzed: AnalyzedBatchJob[];
  remaining: InflightBatch[];
  completedDurationMs: number | null;
  failed: number;
}> {
  const inflight = await loadInflightBatches();

  if (inflight.length === 0) {
    return { analyzed: [], remaining: [], completedDurationMs: null, failed: 0 };
  }

  const provider = getAIProvider();

  if (!provider?.getBatch) {
    logger.warn("⚠️ Current AI provider cannot collect batch jobs; re-queuing inflight jobs");
    await enqueueBatchJobs(inflight.flatMap((batch) => batch.jobs));
    await saveInflightBatches([]);
    return { analyzed: [], remaining: [], completedDurationMs: null, failed: 0 };
  }

  const analyzed: AnalyzedBatchJob[] = [];
  const remaining: InflightBatch[] = [];
  const requeue: Job[] = [];
  const pendingQualifications: Array<{ job: Job; jd: JD; cost: number }> = [];
  const completedDurations: number[] = [];
  const statuses = new Map<string, BatchJobStatus>();
  const invalid: Array<{ job: Job; batch: string; cost: number }> = [];
  const succeeded = new Set<string>();

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

        if (isInvalidResult(parsed)) {
          invalid.push({ job, batch: batch.name, cost: parsed.cost });
          continue;
        }

        const posting = Posting.from(job);

        if (parsed) {
          posting.setJD(parsed.jd);
          succeeded.add(key);
        }

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

  const pendingKeys = new Set(
    remaining.flatMap((batch) => batch.jobs.map((job) => getJobKey(job.link)))
  );
  const invalidResults = await recordInvalidResults(invalid, succeeded, pendingKeys);
  requeue.push(...invalidResults.jobs);

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
    failed: invalidResults.stopped,
  };
}

function durationFromSubmittedAt(submittedAt: string) {
  const started = Date.parse(submittedAt);

  if (!Number.isFinite(started)) {
    return undefined;
  }

  return Math.max(0, Date.now() - started);
}

/**
 * Submits the next chunk of the queue. Without a Batch API it analyzes the chunk in real
 * time and returns the results, which stay queued until the caller persists them and
 * calls `finishRealtimeJobs`.
 */
export async function submitQueuedJobs(limit = Number.POSITIVE_INFINITY): Promise<{
  submitted: number;
  analyzed: AnalyzedBatchJob[];
  failed: number;
}> {
  const stored = await loadBatchQueue();

  if (stored.length === 0 || limit <= 0) {
    return { submitted: 0, analyzed: [], failed: 0 };
  }

  if (!isAIEnabled()) {
    logger.info("📦 AI is disabled; leaving batch queue untouched");
    return { submitted: 0, analyzed: [], failed: 0 };
  }

  const failures = await BatchFailures.load();
  const results = await PendingResults.load();
  const now = Date.now();
  const retry: Job[] = [];
  const active: Job[] = [];

  // A failed AI job only comes back through retryFailedBatchJobs. A failed fetch
  // stays queued until its stop is stored on the opportunity. Replaying that
  // record writes the stop again and does not add another attempt.
  for (const job of stored) {
    const record = failures.get(job);

    if (record?.status !== "failed") {
      active.push(job);
      continue;
    }

    if (record.failure.stage !== "fetch") {
      continue;
    }

    try {
      await saveOpportunityStop(
        job,
        terminalOpportunityStop(record.failure.error, record.lastFailedAt)
      );
    } catch (error) {
      logger.error(
        { company: job.company, url: job.link, err: error },
        `${RED_CROSS} Could not save the JD fetch stop; the job stays queued`
      );
      retry.push(job);
    }
  }

  // A job with a saved real-time result waits for loadRealtimeResults instead.
  const waiting = active.filter((job) => results.has(job));
  const candidates = active.filter((job) => {
    if (results.has(job)) {
      return false;
    }

    const nextAttemptAt = failures.get(job)?.nextAttemptAt;

    if (!nextAttemptAt) {
      return true;
    }

    const due = Date.parse(nextAttemptAt);
    return !Number.isFinite(due) || due <= now;
  });
  const delayed = active.filter((job) => !results.has(job) && !candidates.includes(job));

  if (candidates.length === 0) {
    const nextQueue = [...retry, ...delayed, ...waiting];
    const unchanged =
      nextQueue.length === stored.length &&
      nextQueue.every((job, index) => job.link === stored[index]?.link);

    if (!unchanged) {
      await saveBatchQueue(nextQueue);
    }

    return { submitted: 0, analyzed: [], failed: 0 };
  }

  const provider = getAIProvider();
  const chunk = candidates.slice(0, Math.min(BATCH_CHUNK_SIZE, limit));
  const fetchLimit = pLimit(FETCH_CONCURRENCY);
  const fetched: Array<{ job: Job; rawJD: string }> = [];
  const terminal: Job[] = [];
  let stopped = 0;

  const fetchResults = await Promise.all(
    chunk.map((job) =>
      fetchLimit(async () => {
        const attemptId = `fetch:${randomUUID()}`;
        const { jd: rawJD, error } = await Posting.from(job).getRawJD();
        return { job, rawJD, error, attemptId };
      })
    )
  );

  for (const { job, rawJD, error, attemptId } of fetchResults) {
    if (!rawJD) {
      const at = new Date().toISOString();
      const before = failures.get(job)?.status;
      const { record, counted } = failures.record(job, {
        id: attemptId,
        at,
        failure: { stage: "fetch", error },
        cost: 0,
      });

      if (!counted) {
        (record.status === "failed" ? terminal : retry).push(job);
        continue;
      }

      if (isTemporaryJDFetch(error) && record.status === "retrying") {
        if (error.retryAfterMs !== undefined) {
          failures.schedule(job, new Date(Date.now() + error.retryAfterMs).toISOString());
        }

        logFailedAttempt(job, failures.get(job) ?? record);
        retry.push(job);
        continue;
      }

      const stoppedRecord = record.status === "failed" ? record : (failures.finish(job) ?? record);

      if (
        stoppedByThisAttempt(before, counted, record.status) ||
        (before !== "failed" && stoppedRecord.status === "failed")
      ) {
        stopped += 1;
      }

      logFailedAttempt(job, stoppedRecord);
      terminal.push(job);
      continue;
    }

    fetched.push({ job, rawJD });
  }

  await failures.save();

  for (const job of terminal) {
    const record = failures.get(job);

    if (record?.failure.stage !== "fetch") {
      retry.push(job);
      continue;
    }

    try {
      await saveOpportunityStop(
        job,
        terminalOpportunityStop(record.failure.error, record.lastFailedAt)
      );
    } catch (error) {
      logger.error(
        {
          company: job.company,
          url: job.link,
          attemptId: record.attempts.at(-1)?.id,
          err: error,
        },
        `${RED_CROSS} Could not save the JD fetch stop; the job stays queued`
      );
      retry.push(job);
    }
  }

  const leftover = [...retry, ...delayed, ...candidates.slice(chunk.length), ...waiting];

  if (fetched.length === 0) {
    await saveBatchQueue(leftover);
    return { submitted: 0, analyzed: [], failed: stopped };
  }

  if (!provider?.submitBatch || !provider.getBatch) {
    logger.warn("⚠️ Current AI provider has no Batch API; analyzing queued jobs in real time");
    const realtime = await analyzeJobsRealtime(fetched, failures, results);
    // A job that just failed for good leaves the queue only after its record is saved.
    await failures.save();
    await saveBatchQueue([...realtime.kept, ...leftover]);
    return { submitted: 0, analyzed: realtime.analyzed, failed: stopped + realtime.stopped };
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
    return { submitted: 0, analyzed: [], failed: stopped };
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

  return { submitted: fetched.length, analyzed: [], failed: stopped };
}
