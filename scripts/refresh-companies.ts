import path from "node:path";
import { fileURLToPath } from "node:url";

import { RED_CROSS } from "@/constants/log";

import type { Company } from "@/types";

import { buildCompanyList, getCompanyKey } from "@/modules/employer/build";
import { remapStoredCompany } from "@/modules/employer/remap";
import {
  loadJobsInFileOrder,
  loadOpportunities,
  loadUrls,
  saveJob,
  saveOpportunities,
} from "@/utils/data";
import { logger } from "@/utils/logger";

export interface RemapStoredCompanyNamesResult {
  jobs: number;
  opportunities: number;
}

/**
 * Rewrite stored job/opportunity company fields after identifier remaps.
 * Only updates rows whose company still matches the URL tenant (e.g. globalhr → rtx).
 */
export async function remapStoredCompanyNames(
  companies: Company[]
): Promise<RemapStoredCompanyNamesResult> {
  const companiesByKey = new Map(companies.map((company) => [getCompanyKey(company), company]));

  const jobs = await loadJobsInFileOrder();
  const opportunities = await loadOpportunities();

  let jobsUpdated = 0;
  const nextJobs = jobs.map((job) => {
    const next = remapStoredCompany(job, companiesByKey);

    if (next.company !== job.company) {
      jobsUpdated++;
    }

    return next;
  });

  let opportunitiesUpdated = 0;
  const nextOpportunities = opportunities.map((opportunity) => {
    const next = remapStoredCompany(opportunity, companiesByKey);

    if (next.company !== opportunity.company) {
      opportunitiesUpdated++;
    }

    return next;
  });

  if (jobsUpdated > 0) {
    await saveJob(nextJobs, true);
  }

  if (opportunitiesUpdated > 0) {
    await saveOpportunities(nextOpportunities, true);
  }

  return {
    jobs: jobsUpdated,
    opportunities: opportunitiesUpdated,
  };
}

async function main() {
  const urls = await loadUrls();
  const companies = await buildCompanyList(urls);
  const remapped = await remapStoredCompanyNames(companies);

  logger.info(remapped, "🏷️ Remapped stored job company names");
}

const isDirectRun =
  process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((err) => {
    logger.fatal({ err }, `${RED_CROSS} Fatal error`);
    process.exit(1);
  });
}
