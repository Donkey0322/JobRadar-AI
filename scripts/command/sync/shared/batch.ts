import { persistAnalyzedJobs } from "./index";

import {
  collectInflightBatches,
  loadBatchQueue,
  loadInflightBatches,
  submitQueuedJobs,
} from "@/modules/job-analysis/batch-queue";
import { logger } from "@/utils/logger";

export const DEFAULT_SOFT_DEADLINE_MS = 20 * 60 * 1000;
export const BATCH_POLL_INTERVAL_MS = 20 * 1000;
const MIN_TIME_TO_SUBMIT_MS = 60 * 1000;

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export default async function processBatchQueue(
  softDeadlineMs = DEFAULT_SOFT_DEADLINE_MS,
  options: {
    pollIntervalMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {}
) {
  const pollIntervalMs = options.pollIntervalMs ?? BATCH_POLL_INTERVAL_MS;
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = Date.now();

  function remainingMs() {
    return Math.max(0, softDeadlineMs - (Date.now() - startedAt));
  }

  let collectedCount = 0;
  let submitted = 0;
  let totalCost = 0;
  let notifyCount = 0;

  async function collectAndPersist() {
    const collected = await collectInflightBatches();
    const persisted = await persistAnalyzedJobs(collected.analyzed);
    collectedCount += collected.analyzed.length;
    totalCost += persisted.totalCost;
    notifyCount += persisted.count;
    return collected;
  }

  await collectAndPersist();

  for (;;) {
    let submittedThisRound = 0;

    while (remainingMs() > MIN_TIME_TO_SUBMIT_MS) {
      const queue = await loadBatchQueue();

      if (queue.length === 0) {
        break;
      }

      const result = await submitQueuedJobs();

      if (result.analyzed.length > 0) {
        const fallback = await persistAnalyzedJobs(result.analyzed);
        totalCost += fallback.totalCost;
        notifyCount += fallback.count;
      }

      if (result.submitted === 0 && result.analyzed.length === 0) {
        break;
      }

      submitted += result.submitted;
      submittedThisRound += result.submitted;
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

  logger.info(
    {
      collected: collectedCount,
      submitted,
      notified: notifyCount,
      inflight: inflight.length,
      queued: (await loadBatchQueue()).length,
      cost: totalCost,
    },
    "📦 Batch analysis pass finished"
  );

  return {
    collected: collectedCount,
    submitted,
    notified: notifyCount,
    totalCost,
    inflight: inflight.length,
  };
}
