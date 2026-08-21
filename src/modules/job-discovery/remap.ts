import type { Company } from "@/types";

import { getCompanyKey } from "./company";

import { classifyATS, getATSFetcher } from "@/modules/ats/core";
import { loadJobsInFileOrder, loadOpportunities, saveJob, saveOpportunities } from "@/utils/data";
import { capitalize } from "@/utils/string";
import { getHostnameWithoutWww } from "@/utils/url";

export interface RemapStoredCompanyNamesResult {
  jobs: number;
  opportunities: number;
}

function tenantHintFromUrl(url: URL): string | undefined {
  if (url.hostname.endsWith("myworkdaysite.com")) {
    const parts = url.pathname.split("/").filter(Boolean);
    const recruitingIndex = parts.findIndex((part) => part.toLowerCase() === "recruiting");
    return parts[recruitingIndex + 1];
  }

  return url.hostname.split(".")[0];
}

function remapRecord<T extends { company: string; link: string }>(
  record: T,
  companiesByKey: Map<string, Company>
): T {
  try {
    const url = new URL(record.link);
    const company = companiesByKey.get(getATSFetcher(classifyATS(url)).companyKeyFromUrl(url));

    if (!company) {
      return record;
    }

    const displayName = capitalize(company.name);

    if (record.company === displayName) {
      return record;
    }

    const tenant = tenantHintFromUrl(url);
    const storedLower = record.company.toLowerCase();
    const isUrlTenant = Boolean(tenant && storedLower === tenant.toLowerCase());
    const isCanonicalSlug = storedLower === company.name.toLowerCase();
    const isIdentifier = Boolean(
      company.identifier && storedLower === company.identifier.toLowerCase()
    );
    const isHostname = storedLower === getHostnameWithoutWww(url).toLowerCase();

    if (!isUrlTenant && !isCanonicalSlug && !isIdentifier && !isHostname) {
      return record;
    }

    return {
      ...record,
      company: displayName,
    };
  } catch {
    return record;
  }
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
    const next = remapRecord(job, companiesByKey);

    if (next.company !== job.company) {
      jobsUpdated++;
    }

    return next;
  });

  let opportunitiesUpdated = 0;
  const nextOpportunities = opportunities.map((opportunity) => {
    const next = remapRecord(opportunity, companiesByKey);

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
