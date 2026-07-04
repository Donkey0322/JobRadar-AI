import z from "zod";

import { ABORT_SIGNAL } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { Company } from "../../type";
import type { Job } from "@/types";

import { isTarget, withinDays } from "@/modules/company-tacker/utils";
import { logger } from "@/utils/logger";

const MICROSOFT_CAREERS_URL = "https://jobs.careers.microsoft.com";
const MICROSOFT_API_URL =
  "https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com";

export const MicrosoftCompany = {
  name: "Microsoft",
  ats: "custom",
  identifier: "microsoft",
  domain: "https://jobs.careers.microsoft.com",
  page: MICROSOFT_API_URL,
  urls: [],
} as const satisfies Company;

export const MicrosoftJobSchema = z.object({
  name: z.string(),
  positionUrl: z.string(),
  locations: z.array(z.string()),
  creationTs: z.number(),
  postedTs: z.number(),
});

type MicrosoftJob = z.infer<typeof MicrosoftJobSchema>;

export const MicrosoftResponseSchema = z.object({
  data: z
    .object({
      positions: z.array(MicrosoftJobSchema),
    })
    .optional(),
});

const PAGE_SIZE = 100;
const MAX_PAGES = 5;

function getMicrosoftJobsFromResponse(data: unknown): MicrosoftJob[] {
  const parsed = MicrosoftResponseSchema.safeParse(data);

  if (!parsed.success) {
    logger.error(
      { data, issues: parsed.error.issues },
      `${RED_CROSS} Invalid Microsoft response`
    );

    return [];
  }

  return parsed.data.data?.positions ?? [];
}

function normalizeMicrosoftJob(job: MicrosoftJob): Job {
  return {
    company: "Microsoft",
    role: job.name,
    link: `${MICROSOFT_CAREERS_URL}/${job.positionUrl}`,
    location: job.locations?.[0] ?? "",
  };
}

export async function fetchMicrosoft(
  company: Company,
  urls: Set<string>,
  signal: AbortSignal = ABORT_SIGNAL
): Promise<Job[]> {
  try {
    const jobs: Job[] = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(company.page);

      url.searchParams.set("start", String(page * PAGE_SIZE));
      url.searchParams.set("sort_by", "timestamp");

      const res = await fetch(url.toString(), {
        signal,
      });

      if (!res.ok) {
        break;
      }

      const rawJobs = getMicrosoftJobsFromResponse(await res.json());

      if (rawJobs.length === 0) {
        break;
      }

      let reachedOldJob = false;

      const opportunities = rawJobs
        .filter((job) => {
          if (!withinDays(job.creationTs * 1000) && !withinDays(job.postedTs * 1000)) {
            reachedOldJob = true;
            return false;
          }

          return isTarget(job.name) && !urls.has(`${MICROSOFT_CAREERS_URL}/${job.positionUrl}`);
        })
        .map(normalizeMicrosoftJob);

      jobs.push(...opportunities);

      if (reachedOldJob) {
        break;
      }
    }

    return jobs;
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
