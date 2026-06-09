import "dotenv/config";
import { CONFIG } from "@/constants";

import type { Country } from "@/validation/config";

import { createSyncContext, processJobs } from "./shared";

import { classifyLocations } from "@/modules/company-tacker/ai";
import discoverJobs from "@/modules/company-tacker/fetch";
import { logger } from "@/utils/logger";

export default async function syncDiscover() {
  logger.info("🔍 Discovering jobs...");

  const context = await createSyncContext();

  const jobs = await discoverJobs();
  const locations = await classifyLocations(jobs);

  const allowedCountries =
    CONFIG.target.countries.length > 0
      ? new Set<Country>([...CONFIG.target.countries, "Unsure", "Remote"])
      : new Set<Country>([]);

  await processJobs({
    jobs,
    ...context,

    filter(job) {
      const index = jobs.indexOf(job);
      const location = locations[index];

      if (allowedCountries.size > 0 && !allowedCountries.has(location)) {
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
