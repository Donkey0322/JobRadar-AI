import { GREENHOUSE_API_URL } from "@/constants/ats";
import { RED_CROSS } from "@/constants/log";

import type { Company } from "../type";

import { isTarget, withinDays } from "../utils";

import { logger } from "@/utils/logger";

interface GreenhouseJob {
  company_name: string;
  title: string;
  absolute_url: string;
  first_published: string;
  updated_at: string;
  location?: {
    name: string;
  };
}

export function urlToGreenhouseCompany(url: URL): Company {
  const parts = url.pathname.split("/").filter(Boolean);
  const identifier = parts[0];
  const host = url.hostname;

  // embed
  if (!host.endsWith("greenhouse.io")) {
    const identifier = host.replace("www.", "").split(".")[0] ?? "";
    return {
      name: identifier,
      ats: "greenhouse",
      identifier,
      domain: url.origin,
      page: `${GREENHOUSE_API_URL}/${identifier}/jobs`,
      urls: [],
    };
  }

  return {
    name: identifier,
    ats: "greenhouse",
    identifier,
    domain: url.origin,
    page: `${GREENHOUSE_API_URL}/${identifier}/jobs`,
    urls: [],
  };
}

export async function fetchGreenhouse(company: Company, urls: Set<string>, timeout: number = 5000) {
  try {
    const res = await fetch(company.page, {
      signal: AbortSignal.timeout(timeout),
    });
    const data = await res.json();

    if (!res.ok || !data.jobs) {
      // console.log(company.name, res.status, res.statusText, res.url);
      return [];
    }

    const jobs: GreenhouseJob[] = data.jobs.filter(
      (job: GreenhouseJob) =>
        isTarget(job.title) &&
        !urls.has(job.absolute_url) &&
        (withinDays(job.first_published) || withinDays(job.updated_at))
    );

    return jobs.map((job) => ({
      company: job.company_name,
      role: job.title,
      link: job.absolute_url,
      location: job.location?.name ?? "",
    }));
  } catch (error) {
    logger.error(
      { err: error, company: company.name },
      `${RED_CROSS} Error fetching greenhouse jobs`
    );
    return [];
  }
}
