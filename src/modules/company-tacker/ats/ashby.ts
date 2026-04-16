import type { Company } from "../type";

import { isTarget, withinDays } from "../utils";

import { ASHBY_API_URL } from "@/constants/ats";
import { logger } from "@/utils/logger";

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

    const interns: AshbyJob[] = data.jobs.filter(
      (job: AshbyJob) => isTarget(job.title) && !urls.has(job.jobUrl) && withinDays(job.publishedAt)
    );

    return interns.map((job) => ({
      company: company.name,
      role: job.title,
      link: job.jobUrl,
      location: job.location,
    }));
  } catch (error) {
    logger.error({ err: error, company: company.name }, "❌ Error fetching ashby jobs");
    return [];
  }
}
