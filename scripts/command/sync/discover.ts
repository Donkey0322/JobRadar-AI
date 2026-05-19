import "dotenv/config";
import { CONFIG } from "@/constants";
import { GREEN_CHECKMARK } from "@/constants/log";

import type { Job } from "@/types";
import type { Country } from "@/validation/config";

import { classifyLocations } from "@/modules/company-tacker/ai";
import { buildCompanyList } from "@/modules/company-tacker/company";
import discoverJobs from "@/modules/company-tacker/fetch";
import getJD, { isEligibleJD } from "@/modules/jd-analyzer";
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
  const locations = await classifyLocations(newJobs);
  const allowedCountries =
    CONFIG.target.countries.length > 0
      ? new Set<Country>([...CONFIG.target.countries, "Unsure", "Remote"])
      : new Set<Country>([]);

  const jobs: Job[] = [];
  let totalCost = 0;
  for (let index = 0; index < newJobs.length; index++) {
    const job = newJobs[index];
    const location = locations[index];

    const key = getJobKey(job.link);
    if (keys.has(key)) {
      continue;
    }

    urls.add(job.link);
    keys.add(key);

    if (allowedCountries.size > 0 && !allowedCountries.has(location)) {
      logger.info(
        {
          company: job.company,
          role: job.role,
          location,
        },
        "⏭️ Skipped by location filter"
      );
      continue;
    }

    const { jd, rawJD, cost } = await getJD(job);
    totalCost += cost;

    if (jd) {
      if (!isEligibleJD(jd)) {
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
  logger.info({ totalCost }, "💰 Processed jobs: Total cost");

  if (jobs.length > 0) {
    const companies = await buildCompanyList(urls);
    logger.info({ count: companies.length }, `${GREEN_CHECKMARK} Successfully built companies`);
  }
}
