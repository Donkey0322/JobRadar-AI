import { ASHBY_API_URL } from "@/constants/ats";
import { RED_CROSS } from "@/constants/log";

import type { Company } from "../type";

import { isTarget, withinDays } from "../utils";

import { appendErrorLog } from "@/utils/data";
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

export async function fetchAshby(company: Company, urls: Set<string>, signal: AbortSignal) {
  try {
    const res = await fetch(company.page, {
      signal,
    });

    if (!res.ok) {
      await appendErrorLog(`Ashby: ${company.name} - ${res.status} - ${res.statusText}`);
      return [];
    }

    const data = await res.json();

    if (!data?.jobs) {
      logger.warn(
        {
          company: company.name,
        },
        "⚠️ Ashby missing jobs field"
      );

      return [];
    }

    const jobs: AshbyJob[] = data.jobs.filter(
      (job: AshbyJob) =>
        job?.title &&
        job?.jobUrl &&
        isTarget(job.title) &&
        !urls.has(job.jobUrl) &&
        withinDays(job.publishedAt)
    );

    return jobs.map((job) => ({
      company: capitalize(company.name),
      role: job.title,
      link: job.jobUrl,
      location: job.location ?? "",
    }));
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      logger.warn(
        {
          company: company.name,
          url: company.page,
        },
        "⚠️ Ashby request aborted"
      );

      return [];
    }

    logger.error(
      {
        error,
        company: company.name,
        url: company.page,
      },
      `${RED_CROSS} Error fetching ashby jobs`
    );

    return [];
  }
}
