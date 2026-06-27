import { ABORT_SIGNAL } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { Company } from "../../type";
import type { Job } from "@/types";

import { isTarget, withinDays } from "@/modules/company-tacker/utils";
import { logger } from "@/utils/logger";
import { capitalize } from "@/utils/string";

interface AmazonJob {
  title: string[];
  url: string;
  location: string[];
  createdDate: number[];
  updatedDate: number[];
  icimsJobId: string[];
}

export async function fetchAmazon(
  company: Company,
  urls: Set<string>,
  signal: AbortSignal = ABORT_SIGNAL
): Promise<Job[]> {
  try {
    const res = await fetch(company.page, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        size: 100,
        start: 0,
        sort: { sortOrder: "DESCENDING", sortType: "CREATED_DATE" },
      }),
      signal,
    });

    const data = await res.json();
    const jobs: AmazonJob[] = data.searchHits
      .map(({ fields }: { fields: AmazonJob }) => fields)
      .filter(
        (job: AmazonJob) =>
          isTarget(job.title?.[0] ?? "") &&
          !urls.has(`https://amazon.jobs/en/jobs/${job.icimsJobId?.[0]}`) &&
          (withinDays(job.createdDate?.[0] * 1000) || withinDays(job.updatedDate?.[0] * 1000))
      );

    return jobs.map((job) => ({
      company: capitalize(company.name),
      role: job.title?.[0] ?? "",
      link: `https://amazon.jobs/en/jobs/${job.icimsJobId?.[0]}`,
      location: job.location?.[0] ?? "",
    }));
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      logger.error(
        { err: "TimeoutError", company: company.name, url: company.page },
        `${RED_CROSS} Error fetching amazon jobs`
      );
      return [];
    }

    logger.error({ err: error, company: company.name }, `${RED_CROSS} Error fetching amazon jobs`);
    return [];
  }
}
