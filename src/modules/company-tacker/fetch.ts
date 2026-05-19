import pLimit from "p-limit";

import type { Company } from "./type";
import type { Job } from "@/types";

import {
  fetchAshby,
  fetchCustom,
  fetchGreenhouse,
  fetchLever,
  fetchOracleCloud,
  fetchSmartRecruiters,
  fetchWorkday,
} from "./ats";

import { loadCompanies } from "@/utils/data";
import { logger } from "@/utils/logger";

const limit = pLimit(20);

export async function fetchJobs(
  company: Company,
  urls: Set<string>,
  timeout: number = 5000
): Promise<Job[]> {
  switch (company.ats) {
    case "greenhouse":
      return fetchGreenhouse(company, urls, timeout);
    case "lever":
      return fetchLever(company, urls, timeout);
    case "workday":
      return fetchWorkday(company, urls, timeout);
    case "ashby":
      return fetchAshby(company, urls, timeout);
    case "custom":
      return fetchCustom(company, urls, timeout);
    case "smartrecruiters":
      return fetchSmartRecruiters(company, urls, timeout);
    case "oraclecloud":
      return fetchOracleCloud(company, urls, timeout);
    case "icims":
      return [];
    default:
      company.ats satisfies never;
      return [];
  }
}

export default async function discoverJobs() {
  const companies = await loadCompanies();

  const companyUrls: Record<string, Set<string>> = companies.reduce(
    (acc, company) => {
      acc[`${company.ats}:${company.identifier}`] = new Set(company.urls);
      return acc;
    },
    {} as Record<string, Set<string>>
  );

  const startTime = Date.now();

  const results = await Promise.all(
    companies.map((company) =>
      limit(async () => {
        const jobs = await fetchJobs(company, companyUrls[`${company.ats}:${company.identifier}`]);
        return jobs;
      })
    )
  );

  const newJobs = results.flat();
  const endTime = Date.now();

  logger.info(
    {
      count: newJobs?.length ?? 0,
      duration: ((endTime - startTime) / 1000).toFixed(2),
    },
    "🔍 Discover jobs finished"
  );

  return newJobs ?? [];
}
