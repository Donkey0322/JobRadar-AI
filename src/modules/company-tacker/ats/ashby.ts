import { ASHBY_API_URL } from "@/constants/ats";
import { RED_CROSS } from "@/constants/log";

import type { Company } from "../type";

import { isTarget, withinDays } from "../utils";

import { logger } from "@/utils/logger";
import { capitalize } from "@/utils/string";

export interface AshbyJob {
  id: string;
  title: string;
  location: string;
  jobUrl: string;
  publishedAt: string;
}

export function urlToAshbyCompany(url: URL): Company {
  const identifier = url.pathname.split("/")[1];
  return {
    name: identifier,
    ats: "ashby",
    identifier,
    domain: url.origin,
    page: `${ASHBY_API_URL}/${identifier}`,
    urls: [],
  };
}

export async function fetchAshby(company: Company, urls: Set<string>) {
  try {
    const res = await fetch(company.page);
    if (!res.ok) {
      // console.log(company.name, res.status, res.statusText, res.url);
      return [];
    }
    const data = await res.json();

    const jobs: AshbyJob[] = data.jobs.filter(
      (job: AshbyJob) => isTarget(job.title) && !urls.has(job.jobUrl) && withinDays(job.publishedAt)
    );

    return jobs.map((job) => ({
      company: capitalize(company.name),
      role: job.title,
      link: job.jobUrl,
      location: job.location,
    }));
  } catch (error) {
    logger.error({ err: error, company: company.name }, `${RED_CROSS} Error fetching ashby jobs`);
    return [];
  }
}
