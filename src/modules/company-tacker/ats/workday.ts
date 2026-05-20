import { RED_CROSS } from "@/constants/log";

import type { Company } from "../type";

import { isTarget } from "../utils";

import { logger } from "@/utils/logger";
import { capitalize } from "@/utils/string";

interface WorkdayJob {
  title: string;
  postedOn: string;
  locationsText: string;
  externalPath: string;
}

export function urlToWorkdayCompany(url: URL): Company {
  const name = url.hostname.split(".")[0];
  const parts = url.pathname.split("/").filter(Boolean);
  const isLocale = (str: string) => /^[a-z]{2}-[A-Z]{2}$/.test(str);
  const careerPage = (parts.find((p) => !isLocale(p)) || "").toLowerCase();

  return {
    name,
    ats: "workday",
    identifier: `${name}-${careerPage}`,
    domain: `${url.origin}/${careerPage}`,
    page: `${url.origin}/wday/cxs/${name}/${careerPage}/jobs`,
    urls: [],
  };
}

export async function fetchWorkday(company: Company, urls: Set<string>, timeout: number = 5000) {
  let offset = 0;
  const limit = 20;
  let hasMore = true;

  const results: WorkdayJob[] = [];

  try {
    while (hasMore) {
      const res = await fetch(company.page, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          appliedFacets: {},
          limit,
          offset,
          searchText: "software",
        }),
        signal: AbortSignal.timeout(timeout),
      });

      if (!res.ok) {
        // console.log(company.name, res.status, res.statusText, res.url);
        return [];
      }

      const data = await res.json();

      const jobs = data.jobPostings || [];
      results.push(...jobs);

      offset += limit;
      hasMore = jobs.length === limit && jobs[jobs.length - 1].postedOn === "Posted Today";
    }
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      logger.error(
        { err: "TimeoutError", company: company.name, url: company.page },
        `${RED_CROSS} Error fetching workday jobs`
      );
      return [];
    }

    logger.error({ err: error, company: company.name }, `${RED_CROSS} Error fetching workday jobs`);
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
