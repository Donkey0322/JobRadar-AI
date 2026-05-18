import "dotenv/config";
import { GREEN_CHECKMARK, RED_CROSS } from "@/constants/log";

import type { Job } from "@/types";

import { buildCompanyList } from "@/modules/company-tacker/company";
import discoverJobs from "@/modules/company-tacker/fetch";
import analyzeJD from "@/modules/jd-analyzer";
import { getJobKey, groupUrlsByKey } from "@/modules/job-dedup";
import { loadJobs, loadUrls, saveJd } from "@/utils/data";
import { saveJob, saveUrls } from "@/utils/data";
import { logger } from "@/utils/logger";

export default async function syncDiscover() {
  logger.info("🔍 Discovering jobs...");

  // Idempotent: get all previously sent urls
  const urls = await loadUrls();
  const keys = new Set(groupUrlsByKey(Array.from(urls)).keys());

  // we have to manually track the id of the last sent job
  const sentJobs = await loadJobs();
  let currentId = sentJobs.find((job) => job.id)?.id ?? 0;

  const newJobs = await discoverJobs();

  const jobs: Job[] = [];
  let totalCost = 0;
  for (const job of newJobs) {
    const key = getJobKey(job.link);
    if (keys.has(key)) {
      continue;
    }

    const { jd, rawJD, cost } = await analyzeJD(job);
    totalCost += cost;
    if (jd) {
      currentId += 1;
      job.id = currentId;
      job.jd = jd;
      if (!job.season) {
        job.season = jd.season;
      }
      await saveJd(rawJD, job);
    }

    jobs.push(job);
    urls.add(job.link);
    keys.add(key);
  }

  await saveUrls(urls);
  await saveJob(jobs);
  logger.info({ totalCost }, "💰 Processed jobs: Total cost");

  const companies = await buildCompanyList(urls);
  logger.info({ count: companies.length }, `${GREEN_CHECKMARK} Successfully built companies`);
}
