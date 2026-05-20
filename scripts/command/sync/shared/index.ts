import type { Job } from "@/types";

import { buildCompanyList } from "@/modules/company-tacker/company";
import getJD, { isEligibleJD } from "@/modules/jd-analyzer";
import { getJobKey, groupUrlsByKey } from "@/modules/job-dedup";
import { loadJobs, loadUrls } from "@/utils/data";
import { saveJd, saveJob, saveUrls } from "@/utils/data";
import { logger } from "@/utils/logger";

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
   * Filter out jobs that don't match the criteria
   */
  filter?: (job: Job) => Promise<boolean> | boolean;
}

export async function processJobs({
  jobs: incomingJobs,
  urls,
  keys,
  currentId,

  filter,
}: ProcessJobsOptions) {
  const jobs: Job[] = [];

  let totalCost = 0;
  let newUrlAdded = false;
  let skipped = 0;

  for (const job of incomingJobs) {
    const key = getJobKey(job.link);

    if (keys.has(key)) {
      continue;
    }

    urls.add(job.link);
    keys.add(key);
    newUrlAdded = true;

    if (filter && (await filter(job))) {
      skipped += 1;
      continue;
    }

    const { jd, rawJD, cost } = await getJD(job);

    totalCost += cost;

    if (jd) {
      if (!isEligibleJD(jd)) {
        skipped += 1;
        logger.info(
          {
            company: job.company,
            role: job.role,
          },
          "⏭️ Skipped by eligibility filter"
        );

        continue;
      }

      currentId += 1;

      job.id = currentId;
      job.jd = jd;

      if (!job.season) {
        job.season = jd.season;
      }

      await saveJd(rawJD, job);
    }

    jobs.push(job);
  }

  await saveUrls(urls);
  await saveJob(jobs);

  if (jobs.length > 0) {
    logger.info(
      { cost: totalCost, skipped },
      `💰 Processed jobs!!! We found ${jobs.length} jobs that match your criteria`
    );
  } else {
    logger.info("💰 Currently no newly found jobs that match your criteria");
  }

  if (newUrlAdded) {
    await buildCompanyList(urls);
  }

  return jobs;
}
