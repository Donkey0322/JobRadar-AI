import pLimit from "p-limit";

import type { Company } from "./type";
import type { Job } from "@/types";

import { getJobKey } from "../job-dedup";

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
  timeout: number = 20000
): Promise<Job[]> {
  let jobs: Job[] = [];
  switch (company.ats) {
    case "greenhouse":
      jobs = await fetchGreenhouse(company, urls, timeout);
      break;
    case "lever":
      jobs = await fetchLever(company, urls, 30000);
      break;
    case "workday":
      jobs = await fetchWorkday(company, urls, timeout);
      break;
    case "ashby":
      jobs = await fetchAshby(company, urls, timeout);
      break;
    case "custom":
      jobs = await fetchCustom(company, urls, timeout);
      break;
    case "smartrecruiters":
      jobs = await fetchSmartRecruiters(company, urls, timeout);
      break;
    case "oraclecloud":
      jobs = await fetchOracleCloud(company, urls, timeout);
      break;
    case "icims":
      return jobs;
    default:
      company.ats satisfies never;
      return jobs;
  }
  const urlKeys = new Set(jobs.map((job) => getJobKey(job.link)));
  return jobs.filter((job) => !urlKeys.has(getJobKey(job.link)));
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
