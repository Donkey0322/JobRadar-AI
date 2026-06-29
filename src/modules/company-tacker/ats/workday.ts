import { ABORT_SIGNAL } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { Company } from "../type";

import { isTarget } from "../utils";

import { appendErrorLog } from "@/utils/data";
import { logger } from "@/utils/logger";
import { capitalize } from "@/utils/string";

interface WorkdayJob {
  title: string;
  postedOn: string;
  locationsText: string;
  externalPath: string;
}

const PAGE_SIZE = 20;
const MAX_PAGES = 20;

const identifierMap = {
  talentmanagementsolution: "jonas",
} satisfies Record<string, string>;

export function urlToWorkdayCompany(url: URL): Company {
  const name = url.hostname.split(".")[0];
  const identifier = identifierMap[name as keyof typeof identifierMap] ?? name;
  const parts = url.pathname.split("/").filter(Boolean);

  const isLocale = (str: string) => /^[a-z]{2}-[a-z]{2}$/i.test(str);

  const jobIndex = parts.findIndex((p) => p.toLowerCase() === "job");

  const careerPage =
    jobIndex > 0
      ? parts[jobIndex - 1].toLowerCase()
      : (parts.find((p) => !isLocale(p))?.toLowerCase() ?? "external");

  return {
    name: identifier,
    ats: "workday",
    identifier: `${identifier}-${careerPage}`,
    domain: `${url.origin}/${careerPage}`,
    page: `${url.origin}/wday/cxs/${name}/${careerPage}/jobs`,
    urls: [],
  };
}

export async function fetchWorkday(
  company: Company,
  urls: Set<string>,
  signal: AbortSignal = ABORT_SIGNAL
) {
  let offset = 0;

  let page = 0;

  let hasMore = true;

  const results: WorkdayJob[] = [];

  try {
    while (hasMore && page < MAX_PAGES) {
      // already aborted
      if (signal.aborted) {
        logger.warn(
          {
            company: company.name,
          },
          "⚠️ Workday aborted before fetch"
        );

        return [];
      }

      const res = await fetch(company.page, {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          appliedFacets: {},
          limit: PAGE_SIZE,
          offset,
        }),

        signal,
      });

      if (!res.ok) {
        await appendErrorLog(`Workday: ${company.name} - ${res.status} - ${res.statusText}`);

        return [];
      }

      // JSON parse profiling
      const jsonStart = Date.now();

      // parse JSON error handling
      let data;
      try {
        data = await res.json();
      } catch {
        logger.error(
          { company: company.name, url: company.page },
          `${RED_CROSS} Workday JSON parse error`
        );
        return [];
      }

      const jsonDuration = Date.now() - jsonStart;

      // detect huge JSON parse stalls
      if (jsonDuration > 5000) {
        logger.warn(
          {
            company: company.name,
            duration: `${jsonDuration}ms`,
            offset,
            page,
          },
          "🐢 Slow Workday JSON parse"
        );
      }

      const jobs = data.jobPostings || [];

      // empty page
      if (jobs.length === 0) {
        break;
      }

      results.push(...jobs);

      offset += PAGE_SIZE;
      page++;
      hasMore = jobs.length === PAGE_SIZE && jobs[jobs.length - 1]?.postedOn === "Posted Today";
    }

    // infinite pagination protection
    if (page >= MAX_PAGES) {
      logger.warn(
        {
          company: company.name,
          pages: page,
        },
        "⚠️ Workday hit MAX_PAGES limit"
      );
    }
  } catch (error) {
    // timeout / abort
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      logger.warn(
        {
          company: company.name,
          url: company.page,
        },
        "⚠️ Workday request aborted"
      );

      return [];
    }

    if (error instanceof Error && error.message === "Workday JSON parse error") {
      // logger.error(
      //   {
      //     company: company.name,
      //     url: company.page,
      //   },
      //   "⚠️ Workday JSON parse error"
      // );

      return [];
    }

    logger.error(
      {
        err: error,
        company: company.name,
        url: company.page,
      },
      `${RED_CROSS} Error fetching workday jobs`
    );

    return [];
  }

  const jobs = results.filter(
    (job: WorkdayJob) =>
      job?.title &&
      isTarget(job.title) &&
      !urls.has(`${company.domain}${job.externalPath}`) &&
      job.postedOn === "Posted Today"
  );

  return jobs.map((job: WorkdayJob) => ({
    company: capitalize(company.name),
    role: job.title,
    link: `${company.domain}${job.externalPath}`,
    location: job.locationsText ?? "",
  }));
}
