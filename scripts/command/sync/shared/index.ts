import pLimit from "p-limit";

import type { Job } from "@/types";
import type { Opportunity } from "@/types/jobs";

import { buildCompanyList } from "@/modules/company-tacker/company";
import getJD, { isEligibleJD } from "@/modules/jd-analyzer";
import { HttpStatusCode } from "@/modules/jd-analyzer/ats";
import { getJobKey, groupUrlsByKey } from "@/modules/job-dedup";
import { loadJobs, loadUrls, saveOpportunities } from "@/utils/data";
import { saveJob, saveUrls } from "@/utils/data";
import { renderProgress } from "@/utils/dev";
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

export async function processJobs({
  jobs: incomingJobs,
  urls,
  keys,
  currentId,
  filter,
  softDeadlineMs = DEFAULT_SOFT_DEADLINE_MS,
}: ProcessJobsOptions) {
  const startedAt = Date.now();

  function remainingMs() {
    return Math.max(0, softDeadlineMs - (Date.now() - startedAt));
  }

  function shouldStopStartingNewJob() {
    return remainingMs() <= MIN_TIME_TO_START_JOB_MS;
  }

  let newUrlAdded = false;
  const opportunities: Opportunity[] = [];

  function markAsSeen(job: Job) {
    const key = getJobKey(job.link);

    urls.add(job.link);
    keys.add(key);
    opportunities.push({ ...job, postedAt: new Date().toISOString() });
    newUrlAdded = true;
  }

  logger.info({ count: incomingJobs.length }, "👑 Finalizing jobs...");

  const jobs: Job[] = [];

  let totalCost = 0;
  let skipped = 0;
  let forceStopped = false;

  const limit = pLimit(AI_CONCURRENCY);

  let completed = 0;
  const total = incomingJobs.length;

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

        const result = await getJD(job);

        if (HttpStatusCode.isError(result.error.code)) {
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

  const jdSaves: Promise<unknown>[] = [];

  for (const result of results) {
    if (result.type === "deadline") {
      forceStopped = true;
      continue;
    }

    if (result.type === "invalid") {
      skipped += 1;
      logger.error(
        {
          company: result.job.company,
          role: result.job.role,
          url: result.job.link,
          reason: result.error.desc,
        },
        "⚠️ Invalid JD"
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

    const { job, jd, cost } = result;
    job.jd = jd;
    totalCost += cost;

    if (jd) {
      const [eligible, reason] = isEligibleJD(jd);

      if (!eligible) {
        markAsSeen(job);
        skipped += 1;

        logger.info(
          {
            company: job.company,
            role: job.role,
            url: job.link,
            reason,
          },
          "⏭️ Skipped by eligibility filter"
        );

        continue;
      }

      currentId += 1;

      job.id = currentId;

      // jdSaves.push(saveJd(rawJD, job));
    }

    markAsSeen(job);
    jobs.push(job);
  }

  await Promise.all(jdSaves);

  await saveUrls(urls);
  await saveJob(jobs);
  await saveOpportunities(opportunities);

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
      { cost: totalCost, skipped },
      `💰 Processed jobs!!! We found ${jobs.length} jobs that match your criteria`
    );
  } else {
    logger.info(
      { cost: totalCost, skipped },
      "💰 Currently no newly found jobs that match your criteria"
    );
  }

  return {
    jobs,
    count: jobs.length,
    skipped,
    totalCost,
    forceStopped,
  };
}
