import "dotenv/config";
import { ALLOWED_COUNTRIES } from "@/constants";

import { createSyncContext, processJobs } from "./shared";

import { classifyLocations } from "@/modules/job-discovery/ai";
import discoverJobs from "@/modules/job-discovery/fetch";
import { logger } from "@/utils/logger";

export default async function syncDiscover() {
  logger.info({ AI_MODE: process.env.AI_MODE }, "🔍 Discovering jobs...");

  const context = await createSyncContext();

  const jobs = await discoverJobs();
  const locations = await classifyLocations(jobs);

  for (let index = 0; index < jobs.length; index++) {
    const country = locations[index];

    if (country) {
      jobs[index]!.country = country;
    }
  }

  await processJobs({
    jobs,
    ...context,

    filter(job) {
      if (ALLOWED_COUNTRIES.size > 0 && job.country && !ALLOWED_COUNTRIES.has(job.country)) {
        logger.info(
          {
            company: job.company,
            role: job.role,
            url: job.link,
            location: job.location,
            country: job.country,
          },
          "⏭️ Skipped by location filter"
        );

        return true;
      }

      return false;
    },
  });
}
