import { SMART_RECRUITERS_API_URL } from "@/constants/ats";
import { RED_CROSS } from "@/constants/log";

import type { Company } from "../type";

import { isTarget, withinDays } from "../utils";

import { appendErrorLog } from "@/utils/data";
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
  signal: AbortSignal
) {
  try {
    const res = await fetch(company.page, {
      signal,
    });

    if (!res.ok) {
      await appendErrorLog(`Smart Recruiters: ${company.name} - ${res.status} - ${res.statusText}`);
      return [];
    }

    const data = await res.json();

    if (!data.content) {
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
      location: job.location?.fullLocation ?? "",
    }));
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      logger.warn(
        {
          company: company.name,
          url: company.page,
        },
        "⚠️ SmartRecruiters request aborted"
      );

      return [];
    }

    logger.error(
      {
        error,
        company: company.name,
      },
      `${RED_CROSS} Error fetching smart recruiters jobs`
    );

    return [];
  }
}
