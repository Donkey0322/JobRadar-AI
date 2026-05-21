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
import { renderProgress } from "@/utils/dev";
import { logger } from "@/utils/logger";

const limit = pLimit(20);

const FETCH_TIMEOUT = 20_000;
const LEVER_TIMEOUT = 60_000;

const SLOW_THRESHOLD = 10_000;

export async function fetchJobs(company: Company, urls: Set<string>): Promise<Job[]> {
  const timeout = company.ats === "lever" ? LEVER_TIMEOUT : FETCH_TIMEOUT;
  const signal = AbortSignal.timeout(timeout);

  let jobs: Job[] = [];

  switch (company.ats) {
    case "greenhouse":
      jobs = await fetchGreenhouse(company, urls, signal);
      break;

    case "lever":
      jobs = await fetchLever(company, urls, signal);
      break;

    case "workday":
      jobs = await fetchWorkday(company, urls, signal);
      break;

    case "ashby":
      jobs = await fetchAshby(company, urls, signal);
      break;

    case "custom":
      jobs = await fetchCustom(company, urls, signal);
      break;

    case "smartrecruiters":
      jobs = await fetchSmartRecruiters(company, urls, signal);
      break;

    case "oraclecloud":
      jobs = await fetchOracleCloud(company, urls, signal);
      break;

    case "icims":
      return jobs;

    default:
      company.ats satisfies never;
      return jobs;
  }

  const urlKeys = new Set(Array.from(urls).map(getJobKey));

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

  const total = companies.length;

  let completed = 0;

  const slowCompanies: {
    company: string;
    ats: string;
    duration: number;
  }[] = [];

  const failedCompanies: {
    company: string;
    ats: string;
    duration: number;
    error: unknown;
  }[] = [];

  const startTime = Date.now();

  const results = await Promise.all(
    companies.map((company) =>
      limit(async () => {
        const key = `${company.ats}:${company.identifier}`;

        const start = Date.now();

        try {
          const jobs = await fetchJobs(company, companyUrls[key]);

          const duration = Date.now() - start;

          if (duration >= SLOW_THRESHOLD) {
            slowCompanies.push({
              company: company.name,
              ats: company.ats,
              duration,
            });
          }

          completed++;

          renderProgress(completed, total);

          return jobs;
        } catch (error) {
          const duration = Date.now() - start;

          failedCompanies.push({
            company: company.name,
            ats: company.ats,
            duration,
            error,
          });

          completed++;

          renderProgress(completed, total);

          return [];
        }
      })
    )
  );

  const newJobs = results.flat();

  const endTime = Date.now();

  if (process.stdout.isTTY) {
    process.stdout.write("\n");
  }

  logger.info(
    {
      companies: total,
      jobs: newJobs.length,
      duration: `${((endTime - startTime) / 1000).toFixed(2)}s`,
      slow: slowCompanies.length,
      failed: failedCompanies.length,
    },
    "🔍 Discover jobs finished"
  );

  if (slowCompanies.length > 0) {
    logger.warn(
      {
        companies: slowCompanies.sort((a, b) => b.duration - a.duration).slice(0, 20),
      },
      "🐢 Slow companies"
    );
  }

  if (failedCompanies.length > 0) {
    logger.error(
      {
        companies: failedCompanies.map((c) => ({
          company: c.company,
          ats: c.ats,
          duration: `${c.duration}ms`,
          error: c.error instanceof Error ? c.error.message : String(c.error),
        })),
      },
      "❌ Failed companies"
    );
  }

  return newJobs;
}
