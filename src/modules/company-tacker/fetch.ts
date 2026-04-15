import pLimit from "p-limit";

import type { Company } from "./type";
import type { Job } from "@/types";

import callGemini from "./ai";
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

const limit = pLimit(20);

export async function fetchJobs(company: Company, urls: Set<string>): Promise<Job[]> {
  switch (company.ats) {
    case "greenhouse":
      return fetchGreenhouse(company, urls);
    case "lever":
      return fetchLever(company, urls);
    case "workday":
      return fetchWorkday(company, urls);
    case "ashby":
      return fetchAshby(company, urls);
    case "custom":
      return fetchCustom(company, urls);
    case "smartrecruiters":
      return fetchSmartRecruiters(company, urls);
    case "oraclecloud":
      return fetchOracleCloud(company, urls);
    case "icims":
      return [];
    default:
      company.ats satisfies never;
      return [];
  }
}

export default async function crawler() {
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

  process.stdout.write("\n");

  const newJobs = results.flat();
  const endTime = Date.now();

  const inUS = await callGemini(newJobs);
  const inUSJobs = newJobs.filter((job, index) => inUS?.[index] ?? false);

  console.log(
    `🎉 Crawled ${inUSJobs.length} jobs in ${((endTime - startTime) / 1000).toFixed(2)}s`
  );

  return inUSJobs;
}
