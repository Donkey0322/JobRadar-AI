import type { Job } from "@/types";

import { buildCompanyList } from "@/modules/company-tacker/company";
import getJD, { isEligibleJD } from "@/modules/jd-analyzer";
import { getJobKey, groupUrlsByKey } from "@/modules/job-dedup";
import { loadJobs, loadUrls } from "@/utils/data";
import { saveJd, saveJob, saveUrls } from "@/utils/data";
import { logger } from "@/utils/logger";

const DEFAULT_SOFT_DEADLINE_MS = 10 * 60 * 1000;
const MIN_TIME_TO_START_JOB_MS = 45 * 1000;

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

  function markAsSeen(job: Job) {
    const key = getJobKey(job.link);

    urls.add(job.link);
    keys.add(key);
    newUrlAdded = true;
  }

  logger.info({ count: incomingJobs.length }, "👑 Finalizing jobs...");
  const jobs: Job[] = [];

  let totalCost = 0;
  let skipped = 0;
  let deadlineStopped = false;

  for (const job of incomingJobs) {
    const key = getJobKey(job.link);

    if (keys.has(key)) {
      skipped += 1;

      logger.info(
        {
          company: job.company,
          role: job.role,
          url: job.link,
          reason: "Idempotent job check",
        },
        "⏭️ Skipped by idempotent job check"
      );

      continue;
    }

    if (shouldStopStartingNewJob()) {
      deadlineStopped = true;

      logger.warn(
        {
          remainingSeconds: Math.round(remainingMs() / 1000),
          processed: jobs.length,
          skipped,
        },
        "⏰ Soft deadline reached. Stop starting new jobs and finalize current results."
      );

      break;
    }

    if (filter && (await filter(job))) {
      markAsSeen(job);
      skipped += 1;
      continue;
    }

    const { jd, rawJD, cost } = await getJD(job);

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
      job.jd = jd;

      await saveJd(rawJD, job);
    }

    markAsSeen(job);
    jobs.push(job);
  }

  await saveUrls(urls);
  await saveJob(jobs);

  if (newUrlAdded) {
    await buildCompanyList(urls);
  }

  if (jobs.length > 0) {
    logger.info(
      { cost: totalCost, skipped, deadlineStopped },
      `💰 Processed jobs!!! We found ${jobs.length} jobs that match your criteria`
    );
  } else {
    logger.info(
      { skipped, deadlineStopped },
      "💰 Currently no newly found jobs that match your criteria"
    );
  }

  return {
    jobs,
    count: jobs.length,
    skipped,
    totalCost,
    deadlineStopped,
  };
}
