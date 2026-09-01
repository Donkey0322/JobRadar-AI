import { persistAnalyzedJobs } from "./index";

import {
  collectInflightBatches,
  loadBatchQueue,
  submitQueuedJobs,
} from "@/modules/job-analysis/batch-queue";
import { logger } from "@/utils/logger";

const DEFAULT_SOFT_DEADLINE_MS = 20 * 60 * 1000;
const MIN_TIME_TO_SUBMIT_MS = 60 * 1000;

export default async function processBatchQueue(softDeadlineMs = DEFAULT_SOFT_DEADLINE_MS) {
  const startedAt = Date.now();

  function remainingMs() {
    return Math.max(0, softDeadlineMs - (Date.now() - startedAt));
  }

  const collected = await collectInflightBatches();
  const persisted = await persistAnalyzedJobs(collected.analyzed);

  let submitted = 0;
  let totalCost = persisted.totalCost;
  let notifyCount = persisted.count;

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
  }

  logger.info(
    {
      collected: collected.analyzed.length,
      submitted,
      notified: notifyCount,
      inflight: collected.remaining.length,
      queued: (await loadBatchQueue()).length,
      cost: totalCost,
    },
    "📦 Batch analysis pass finished"
  );

  return {
    collected: collected.analyzed.length,
    submitted,
    notified: notifyCount,
    totalCost,
  };
}
