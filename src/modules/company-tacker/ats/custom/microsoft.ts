import { RED_CROSS } from "@/constants/log";

import type { Company } from "../../type";
import type { Job } from "@/types";

import { isTarget, withinDays } from "@/modules/company-tacker/utils";
import { logger } from "@/utils/logger";

interface MicrosoftJob {
  name: string;
  url: string;
  location: string[];
  creationTs: number;
  postedTs: number;
}

export async function fetchMicrosoft(
  company: Company,
  urls: Set<string>,
  signal: AbortSignal
): Promise<Job[]> {
  try {
    const res = await fetch(company.page, {
      signal,
    });
    const data = await res.json();

    const jobs: MicrosoftJob[] = data?.data?.positions.filter(
      (job: MicrosoftJob) =>
        isTarget(job.name) &&
        !urls.has(`${company.domain}/${job.url}`) &&
        (withinDays(job.creationTs * 1000) || withinDays(job.postedTs * 1000))
    );

    return jobs.map((job) => ({
      company: company.name,
      role: job.name,
      link: `${company.domain}/${job.url}`,
      location: job.location?.[0] ?? "",
    }));
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      logger.error(
        { err: "TimeoutError", company: company.name, url: company.page },
        `${RED_CROSS} Error fetching microsoft jobs`
      );
      return [];
    }

    logger.error(
      { err: error, company: company.name },
      `${RED_CROSS} Error fetching microsoft jobs`
    );
    return [];
  }
}
