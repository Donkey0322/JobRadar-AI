import { SMART_RECRUITERS_API_URL } from "@/constants/ats";
import { RED_CROSS } from "@/constants/log";

import type { Company } from "../type";

import { isTarget, withinDays } from "../utils";

import { logger } from "@/utils/logger";
import { capitalize } from "@/utils/string";

interface SmartRecruitersJob {
  id: string;
  name: string;
  company: {
    name: string;
  };
  releasedDate: string;
  location: {
    fullLocation: string;
  };
}

export function urlToSmartRecruitersCompany(url: URL): Company {
  const parts = url.pathname.split("/").filter(Boolean);
  const identifier = parts[0];

  return {
    name: identifier,
    ats: "smartrecruiters",
    identifier,
    domain: url.origin,
    page: `${SMART_RECRUITERS_API_URL}/${identifier}/postings`,
    urls: [],
  };
}

export async function fetchSmartRecruiters(
  company: Company,
  urls: Set<string>,
  timeout: number = 5000
) {
  try {
    const res = await fetch(company.page, {
      signal: AbortSignal.timeout(timeout),
    });
    const data = await res.json();

    if (!res.ok || !data.content) {
      // console.log(company.name, res.status, res.statusText, res.url);
      return [];
    }

    const jobs: SmartRecruitersJob[] = data.content.filter(
      (job: SmartRecruitersJob) =>
        isTarget(job.name) &&
        !urls.has(`${company.domain}/${company.name}/${job.id}`) &&
        withinDays(job.releasedDate)
    );

    return jobs.map((job) => ({
      company: capitalize(job.company.name ?? ""),
      role: job.name,
      link: `${company.domain}/${company.name}/${job.id}`,
      location: job.location.fullLocation ?? "",
    }));
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      logger.error(
        { err: "TimeoutError", company: company.name, url: company.page },
        `${RED_CROSS} Error fetching smart recruiters jobs`
      );
      return [];
    }

    logger.error(
      { err: error, company: company.name },
      `${RED_CROSS} Error fetching smart recruiters jobs`
    );
    return [];
  }
}
