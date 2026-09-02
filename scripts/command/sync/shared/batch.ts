import { persistAnalyzedJobs } from "./index";

import {
  collectInflightBatches,
  loadBatchQueue,
  loadInflightBatches,
  submitQueuedJobs,
} from "@/modules/job-analysis/batch-queue";
import {
  isBatchCheckDue,
  loadBatchSchedule,
  planNextBatchCheck,
  saveBatchSchedule,
} from "@/modules/job-analysis/batch-schedule";
import { logger } from "@/utils/logger";

const DEFAULT_SOFT_DEADLINE_MS = 20 * 60 * 1000;
const MIN_TIME_TO_SUBMIT_MS = 60 * 1000;

export default async function processBatchQueue(
  softDeadlineMs = DEFAULT_SOFT_DEADLINE_MS,
  options: { ifDue?: boolean } = {}
) {
  const schedule = await loadBatchSchedule();

  if (options.ifDue && !isBatchCheckDue(schedule)) {
    logger.info({ nextCheckAt: schedule.nextCheckAt }, "📦 Batch check not due yet");
    return {
      collected: 0,
      submitted: 0,
      notified: 0,
      totalCost: 0,
      skippedDue: true,
    };
  }

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

  const inflight = await loadInflightBatches();
  const nextSchedule = planNextBatchCheck({
    previous: schedule,
    checkedTooEarly: collected.remaining.length > 0,
    hasInflight: inflight.length > 0,
    submitted,
    completedDurationMs: collected.completedDurationMs ?? null,
  });
  await saveBatchSchedule(nextSchedule);

  logger.info(
    {
      collected: collected.analyzed.length,
      submitted,
      notified: notifyCount,
      inflight: inflight.length,
      queued: (await loadBatchQueue()).length,
      cost: totalCost,
      intervalMs: nextSchedule.intervalMs,
      nextCheckAt: nextSchedule.nextCheckAt,
    },
    "📦 Batch analysis pass finished"
  );

  return {
    collected: collected.analyzed.length,
    submitted,
    notified: notifyCount,
    totalCost,
    skippedDue: false,
    nextCheckAt: nextSchedule.nextCheckAt,
    intervalMs: nextSchedule.intervalMs,
  };
}
