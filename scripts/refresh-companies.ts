import type { Company } from "@/types";

import { renderBuildProgress } from "./utils/progress";

import { buildCompanyList, companyKey } from "@/modules/employer/build";
import { remapStoredCompany } from "@/modules/employer/remap";
import * as store from "@/store";
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
  const companiesByKey = new Map(companies.map((company) => [companyKey(company), company]));

  const jobs = await store.jobs.loadInFileOrder();
  const opportunities = await store.opportunities.load();

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
    await store.jobs.replace(nextJobs);
  }

  if (opportunitiesUpdated > 0) {
    await store.opportunities.replace(nextOpportunities);
  }

  return {
    jobs: jobsUpdated,
    opportunities: opportunitiesUpdated,
  };
}

export async function refreshCompanies() {
  const urls = await store.urls.load();
  const companies = await buildCompanyList(urls, renderBuildProgress);
  const remapped = await remapStoredCompanyNames(companies);

  logger.info(remapped, "🏷️ Remapped stored job company names");
}
