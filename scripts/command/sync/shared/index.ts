import pLimit from "p-limit";

import { RED_CROSS } from "@/constants/log";

import type { OpportunityLedger } from "@/modules/opportunity/seen";
import type { Job } from "@/types";
import type { JD } from "@/types/jobs";

import { buildCompanyList } from "@/modules/employer/build";
import {
  createOpportunityLedger,
  recordSeenOpportunity,
  seenOpportunitiesToWrite,
} from "@/modules/opportunity/seen";
import getJD, { decideNotification } from "@/modules/screen";
import { enqueueBatchJobs } from "@/modules/screen/batch";
import { shouldBatchAnalyze } from "@/modules/screen/titles";
import { loadJobs, loadOpportunities, loadUrls, saveOpportunities } from "@/utils/data";
import { saveJob, saveUrls } from "@/utils/data";
import { renderProgress, startProgress } from "@/utils/dev";
import { deduplicateJobs, getJobKey, groupUrlsByKey } from "@/utils/job-key";
import { logger } from "@/utils/logger";

const DEFAULT_SOFT_DEADLINE_MS = 15 * 60 * 1000;
const MIN_TIME_TO_START_JOB_MS = 60 * 1000;

export async function createSyncContext() {
  const urls = await loadUrls();
  const keys = new Set(groupUrlsByKey(Array.from(urls)).keys());

  const sentJobs = await loadJobs();
  const currentId = sentJobs.find((job) => job.id)?.id ?? 0;

  return {
    urls,
    keys,
    currentId,
  };
}

interface ProcessJobsOptions {
  jobs: Job[];

  urls: Set<string>;
  keys: Set<string>;

  currentId: number;

  /**
   * Filter out jobs that don't match the criteria.
   *
   * Return true to skip the job.
   */
  filter?: (job: Job) => Promise<boolean> | boolean;

  /**
   * Soft deadline for this function.
   *
   * GitHub Actions hard timeout should be longer than this.
   * Example:
   * soft deadline: 10 minutes
   * GitHub timeout-minutes: 15
   */
  softDeadlineMs?: number;
}

const AI_CONCURRENCY = 5;

async function saveSeenOpportunities(ledger: OpportunityLedger) {
  const write = seenOpportunitiesToWrite(ledger);

  if (!write) {
    return;
  }

  if (write.overwrite) {
    await saveOpportunities(write.opportunities, true);
    return;
  }

  await saveOpportunities(write.opportunities);
}

export async function processJobs({
  jobs: rawIncomingJobs,
  urls,
  keys,
  currentId,
  filter,
  softDeadlineMs = DEFAULT_SOFT_DEADLINE_MS,
}: ProcessJobsOptions) {
  const incomingJobs = deduplicateJobs(rawIncomingJobs);
  const startedAt = Date.now();

  function remainingMs() {
    return Math.max(0, softDeadlineMs - (Date.now() - startedAt));
  }

  function shouldStopStartingNewJob() {
    return remainingMs() <= MIN_TIME_TO_START_JOB_MS;
  }

  let newUrlAdded = false;
  const opportunities = createOpportunityLedger(await loadOpportunities());

  function markAsSeen(job: Job) {
    recordSeenOpportunity(opportunities, job, "refresh");
    urls.add(job.link);
    keys.add(getJobKey(job.link));
    newUrlAdded = true;
  }

  logger.info({ count: incomingJobs.length }, "👑 Finalizing jobs...");

  const jobs: Job[] = [];
  const batchedJobs: Job[] = [];

  let totalCost = 0;
  let skipped = 0;
  let failed = 0;
  let batched = 0;
  let forceStopped = false;

  const limit = pLimit(AI_CONCURRENCY);

  let completed = 0;
  const total = incomingJobs.length;

  startProgress(total);

  const results = await Promise.all(
    incomingJobs.map((job) =>
      limit(async () => {
        completed++;
        renderProgress(completed, total);

        const key = getJobKey(job.link);

        if (keys.has(key)) {
          return {
            type: "skip" as const,
            job,
            reason: "idempotent",
          };
        }

        if (shouldStopStartingNewJob()) {
          return {
            type: "deadline" as const,
            job,
          };
        }

        if (filter && (await filter(job))) {
          return {
            type: "skip" as const,
            job,
            reason: "filter",
          };
        }

        if (shouldBatchAnalyze(job.role)) {
          return {
            type: "batch" as const,
            job,
          };
        }

        const result = await getJD(job);

        if (!result.jd) {
          return {
            type: "invalid" as const,
            job,
            ...result,
          };
        }

        return {
          type: "processed" as const,
          job,
          ...result,
        };
      })
    )
  );

  for (const result of results) {
    if (result.type === "deadline") {
      forceStopped = true;
      continue;
    }

    if (result.type === "invalid") {
      failed += 1;
      logger.error(
        {
          company: result.job.company,
          role: result.job.role,
          url: result.job.link,
          code: result.error.code,
          reason: result.error.desc || "No JD returned",
        },
        `${RED_CROSS} Failed to fetch JD`
      );
      continue;
    }

    if (result.type === "skip") {
      if (result.reason === "idempotent") {
        skipped += 1;

        logger.info(
          {
            company: result.job.company,
            role: result.job.role,
            url: result.job.link,
            reason: "Idempotent job check",
          },
          "⏭️ Skipped by idempotent job check"
        );
      } else {
        markAsSeen(result.job);
        skipped += 1;
      }

      continue;
    }

    if (result.type === "batch") {
      markAsSeen(result.job);
      batchedJobs.push(result.job);
      batched += 1;

      logger.info(
        {
          company: result.job.company,
          role: result.job.role,
          url: result.job.link,
        },
        "📦 Queued for batch analysis"
      );

      continue;
    }

    const { job, jd, cost } = result;

    if (!jd) {
      failed += 1;
      logger.error(
        {
          company: job.company,
          role: job.role,
          url: job.link,
          reason: "No JD returned",
        },
        `${RED_CROSS} Failed to fetch JD`
      );
      continue;
    }

    job.jd = jd;
    totalCost += cost;

    const decision = decideNotification(job.role, jd);

    if (decision.action === "skip" && decision.kind === "ineligible") {
      markAsSeen(job);
      skipped += 1;

      logger.info(
        {
          company: job.company,
          role: job.role,
          url: job.link,
          reason: decision.reason,
        },
        "⏭️ Skipped by eligibility filter"
      );

      continue;
    }

    if (decision.action === "skip") {
      markAsSeen(job);
      skipped += 1;

      logger.info(
        {
          company: job.company,
          role: job.role,
          url: job.link,
        },
        "⏭️ Dashboard-only job; notify follows config titles"
      );

      continue;
    }

    currentId += 1;
    job.id = currentId;
    markAsSeen(job);
    jobs.push(job);
  }

  if (batchedJobs.length > 0) {
    await enqueueBatchJobs(batchedJobs);
  }

  await saveUrls(urls);
  await saveJob(jobs);
  await saveSeenOpportunities(opportunities);

  if (newUrlAdded) {
    await buildCompanyList(urls);
  }

  if (forceStopped) {
    logger.warn(
      {
        remainingSeconds: Math.round(remainingMs() / 1000),
      },
      "⏰ Soft deadline reached. Some jobs were not started."
    );
  }

  if (jobs.length > 0) {
    logger.info(
      { cost: totalCost, skipped, failed, batched },
      `💰 Processed jobs!!! We found ${jobs.length} jobs that match your criteria`
    );
  } else {
    logger.info(
      { cost: totalCost, skipped, failed, batched },
      "💰 Currently no newly found jobs that match your criteria"
    );
  }

  return {
    jobs,
    count: jobs.length,
    skipped,
    failed,
    batched,
    totalCost,
    forceStopped,
  };
}

export async function persistAnalyzedJobs(analyzed: Array<{ job: Job; jd: JD; cost: number }>) {
  if (analyzed.length === 0) {
    return {
      jobs: [] as Job[],
      count: 0,
      skipped: 0,
      totalCost: 0,
    };
  }

  const { currentId: startingId } = await createSyncContext();
  let currentId = startingId;
  const opportunities = createOpportunityLedger(await loadOpportunities());
  const jobs: Job[] = [];
  let skipped = 0;
  let totalCost = 0;

  function markAsSeen(job: Job) {
    recordSeenOpportunity(opportunities, job, "preserve");
  }

  for (const item of analyzed) {
    const job = item.job;
    job.jd = item.jd;
    totalCost += item.cost;

    const decision = decideNotification(job.role, item.jd);

    if (decision.action === "skip" && decision.kind === "ineligible") {
      markAsSeen(job);
      skipped += 1;

      logger.info(
        {
          company: job.company,
          role: job.role,
          url: job.link,
          reason: decision.reason,
        },
        "⏭️ Skipped by eligibility filter"
      );
      continue;
    }

    if (decision.action === "skip") {
      markAsSeen(job);
      skipped += 1;

      logger.info(
        {
          company: job.company,
          role: job.role,
          url: job.link,
        },
        "⏭️ Dashboard-only job; notify follows config titles"
      );
      continue;
    }

    currentId += 1;
    job.id = currentId;
    markAsSeen(job);
    jobs.push(job);

    logger.info(
      {
        company: job.company,
        role: job.role,
        url: job.link,
      },
      "✅ Job matches notification criteria"
    );
  }

  await saveJob(jobs);
  await saveSeenOpportunities(opportunities);

  if (jobs.length > 0) {
    logger.info(
      { cost: totalCost, skipped },
      `💰 Batch analysis found ${jobs.length} jobs that match your criteria`
    );
  }

  return {
    jobs,
    count: jobs.length,
    skipped,
    totalCost,
  };
}
