import type { AnalyzedBatchJob } from "@/modules/posting/batch";

import { recordStage } from "../github/summary";
import { persistAnalyzedJobs } from "../ingest";

import {
  collectInflightBatches,
  finishRealtimeJobs,
  loadBatchQueue,
  loadInflightBatches,
  loadRealtimeResults,
  retryFailedBatchJobs,
  saveInflightBatches,
  submitQueuedJobs,
} from "@/modules/posting/batch";
import { BatchFailures } from "@/modules/posting/batch/failures";
import { PendingResults } from "@/modules/posting/batch/results";
import { logger } from "@/utils/logger";

export const DEFAULT_SOFT_DEADLINE_MS = 20 * 60 * 1000;
export const BATCH_POLL_INTERVAL_MS = 20 * 1000;
const MIN_TIME_TO_SUBMIT_MS = 60 * 1000;

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function processBatchQueue(
  softDeadlineMs = DEFAULT_SOFT_DEADLINE_MS,
  options: {
    pollIntervalMs?: number;
    sleep?: (ms: number) => Promise<void>;
    wait?: boolean;
  } = {}
) {
  const pollIntervalMs = options.pollIntervalMs ?? BATCH_POLL_INTERVAL_MS;
  const sleep = options.sleep ?? defaultSleep;
  const wait = options.wait ?? true;
  const startedAt = Date.now();

  function remainingMs() {
    return Math.max(0, softDeadlineMs - (Date.now() - startedAt));
  }

  let collectedCount = 0;
  let submitted = 0;
  let totalCost = 0;
  let notifyCount = 0;
  let persistSkipped = 0;

  async function collectAndPersist() {
    const collected = await collectInflightBatches();
    const persisted = await persistAnalyzedJobs(collected.analyzed);

    if (collected.analyzed.length > 0) {
      await saveInflightBatches(collected.remaining);
    }

    collectedCount += collected.analyzed.length;
    totalCost += persisted.totalCost;
    notifyCount += persisted.count;
    persistSkipped += persisted.skipped;
    return collected;
  }

  async function persistRealtime(analyzed: AnalyzedBatchJob[]) {
    if (analyzed.length === 0) {
      return;
    }

    const persisted = await persistAnalyzedJobs(analyzed);
    await finishRealtimeJobs(analyzed.map((item) => item.job));
    totalCost += persisted.totalCost;
    notifyCount += persisted.count;
    persistSkipped += persisted.skipped;
  }

  await persistRealtime(await loadRealtimeResults());
  await collectAndPersist();

  for (;;) {
    let submittedThisRound = 0;

    while (remainingMs() > MIN_TIME_TO_SUBMIT_MS) {
      const queue = await loadBatchQueue();

      if (queue.length === 0) {
        break;
      }

      const result = await submitQueuedJobs();

      await persistRealtime(result.analyzed);

      if (result.submitted === 0 && result.analyzed.length === 0) {
        break;
      }

      submitted += result.submitted;
      submittedThisRound += result.submitted;
    }

    if (!wait) {
      break;
    }

    while (remainingMs() > pollIntervalMs) {
      const inflight = await loadInflightBatches();

      if (inflight.length === 0) {
        break;
      }

      logger.info(
        { inflight: inflight.length, waitMs: pollIntervalMs, remainingMs: remainingMs() },
        "📦 Waiting for inflight batch jobs to finish"
      );
      await sleep(pollIntervalMs);
      await collectAndPersist();
    }

    const queue = await loadBatchQueue();
    const inflight = await loadInflightBatches();

    if (queue.length === 0 && inflight.length === 0) {
      break;
    }

    if (queue.length > 0 && remainingMs() > MIN_TIME_TO_SUBMIT_MS && submittedThisRound > 0) {
      continue;
    }

    if (inflight.length > 0) {
      logger.warn(
        { inflight: inflight.length },
        "⚠️ Inflight batches still pending; the next batch run will collect them"
      );
    }

    break;
  }

  const inflight = await loadInflightBatches();
  const queued = (await loadBatchQueue()).length;
  const failures = await BatchFailures.load();
  const pendingResults = (await PendingResults.load()).list().length;
  const retrying = failures.list().filter((record) => record.status === "retrying").length;
  const stopped = failures.failed().length;

  logger.info(
    {
      collected: collectedCount,
      submitted,
      notified: notifyCount,
      inflight: inflight.length,
      queued,
      cost: totalCost,
    },
    "📦 Batch analysis pass finished"
  );

  return {
    collected: collectedCount,
    submitted,
    notified: notifyCount,
    persistSkipped,
    totalCost,
    inflight: inflight.length,
    queued,
    retrying,
    stopped,
    pendingResults,
  };
}

export default async function runBatch(
  options: { submitOnly?: boolean; retryFailed?: boolean } = {}
) {
  const mode = options.submitOnly ? "submit" : "collect";
  const started = Date.now();

  try {
    let requeued: number | undefined;
    if (options.retryFailed) {
      requeued = await retryFailedBatchJobs();
      logger.info({ count: requeued }, "📦 Re-queued failed batch jobs");
    }

    const result = await processBatchQueue(undefined, { wait: !options.submitOnly });
    recordStage({
      stage: "batch",
      mode,
      status: result.stopped > 0 ? "partial" : "success",
      submitted: result.submitted,
      collected: result.collected,
      jobsSaved: result.notified,
      persistSkipped: result.persistSkipped,
      queued: result.queued,
      inflight: result.inflight,
      retrying: result.retrying,
      stopped: result.stopped,
      pendingResults: result.pendingResults,
      ...(requeued === undefined ? {} : { requeued }),
      cost: result.totalCost,
      durationMs: Date.now() - started,
      saved: "complete",
    });
  } catch (error) {
    recordStage({
      stage: "batch",
      mode,
      status: "failed",
      reason: "batch failed",
      saved: "unknown",
      durationMs: Date.now() - started,
    });
    throw error;
  }
}
