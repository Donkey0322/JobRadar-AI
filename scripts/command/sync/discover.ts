import "dotenv/config";
import { ALLOWED_COUNTRIES } from "@/constants";

import { createSyncContext, processJobs } from "./shared";

import { classifyLocations } from "@/modules/company-tacker/ai";
import discoverJobs from "@/modules/company-tacker/fetch";
import { logger } from "@/utils/logger";

export default async function syncDiscover() {
  logger.info({ AI_MODE: process.env.AI_MODE }, "🔍 Discovering jobs...");

  const context = await createSyncContext();

  const jobs = await discoverJobs();
  const locations = await classifyLocations(jobs);

  await processJobs({
    jobs,
    ...context,

    filter(job) {
      const index = jobs.indexOf(job);
      const location = locations[index];

      if (ALLOWED_COUNTRIES.size > 0 && !ALLOWED_COUNTRIES.has(location)) {
        logger.info(
          {
            company: job.company,
            role: job.role,
            url: job.link,
            location,
          },
          "⏭️ Skipped by location filter"
        );

        return true;
      }

      return false;
    },
  });
}
