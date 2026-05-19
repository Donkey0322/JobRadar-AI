import { RED_CROSS } from "@/constants/log";

import type { Company } from "../type";

import { isTarget, withinDays } from "../utils";

import { logger } from "@/utils/logger";
import { capitalize } from "@/utils/string";

interface LeverJob {
  company_name: string; // company name
  text: string; // job title
  hostedUrl: string; // job URL
  createdAt: number; // job creation date
  categories: {
    location?: string; // job location
  };
}

export function urlToLeverCompany(url: URL): Company {
  const page = url.origin.includes("eu")
    ? "https://api.eu.lever.co/v0/postings/"
    : "https://api.lever.co/v0/postings/";
  const parts = url.pathname.split("/").filter(Boolean);
  const identifier = parts[0];

  return {
    name: identifier,
    ats: "lever",
    identifier,
    domain: url.origin,
    page: `${page}${identifier}?mode=json`,
    urls: [],
  };
}

export async function fetchLever(company: Company, urls: Set<string>, timeout: number = 5000) {
  try {
    const res = await fetch(company.page, {
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) {
      // console.log(company.name, res.status, res.statusText, res.url);
      return [];
    }
    const data = await res.json();

    const jobs: LeverJob[] = data.filter(
      (job: LeverJob) => isTarget(job.text) && !urls.has(job.hostedUrl) && withinDays(job.createdAt)
    );

    return jobs.map((job: LeverJob) => ({
      company: capitalize(company.name),
      role: job.text,
      link: job.hostedUrl,
      location: job.categories?.location ?? "",
    }));
  } catch (error) {
    logger.error({ err: error, company: company.name }, `${RED_CROSS} Error fetching lever jobs`);
    return [];
  }
}
