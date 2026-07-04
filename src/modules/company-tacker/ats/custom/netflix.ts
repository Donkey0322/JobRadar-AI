import z from "zod";

import { ABORT_SIGNAL } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { Company } from "@/modules/company-tacker/type";
import type { Job } from "@/types";

import { isTarget, withinDays } from "../../utils";

import { logger } from "@/utils/logger";

export const NETFLIX_API_URL = "https://explore.jobs.netflix.net/api/apply/v2/jobs";

export const NetflixCompany = {
  name: "Netflix",
  ats: "custom",
  identifier: "netflix",
  domain: "https://explore.jobs.netflix.net",
  page: NETFLIX_API_URL,
  urls: [],
} as const satisfies Company;

export const NetflixJobSchema = z.object({
  id: z.number(),
  posting_name: z.string(),
  location: z.string(),
  canonicalPositionUrl: z.string(),
  t_create: z.number(),
  t_update: z.number(),
});

type NetflixJob = z.infer<typeof NetflixJobSchema>;

export const NetflixResponseSchema = z.object({
  positions: z.array(NetflixJobSchema),
});

const PAGE_SIZE = 100;
const MAX_PAGES = 5;

function getNetflixJobsFromResponse(data: unknown): NetflixJob[] {
  const parsed = NetflixResponseSchema.safeParse(data);

  if (!parsed.success) {
    logger.error({ data, issues: parsed.error.issues }, `${RED_CROSS} Invalid Netflix response`);

    return [];
  }

  return parsed.data.positions;
}

function normalizeNetflixJob(job: NetflixJob): Job {
  return {
    company: "Netflix",
    role: job.posting_name,
    link: job.canonicalPositionUrl,
    location: job.location,
  };
}

export async function fetchNetflix(
  company: Company,
  urls: Set<string>,
  signal: AbortSignal = ABORT_SIGNAL
): Promise<Job[]> {
  try {
    const jobs: Job[] = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(company.page);

      url.searchParams.set("sort_by", "new");
      url.searchParams.set("num", String(PAGE_SIZE));

      if (page > 0) {
        url.searchParams.set("start", String(page * PAGE_SIZE));
      }

      const res = await fetch(url.toString(), {
        signal,
        headers: {
          Accept: "application/json",
        },
      });

      if (!res.ok) {
        break;
      }

      const rawJobs = getNetflixJobsFromResponse(await res.json());

      if (rawJobs.length === 0) {
        break;
      }

      const opportunities = rawJobs
        .filter(
          (job) =>
            isTarget(job.posting_name) &&
            !urls.has(job.canonicalPositionUrl) &&
            (withinDays(job.t_create) || withinDays(job.t_update))
        )
        .map(normalizeNetflixJob);

      jobs.push(...opportunities);
    }

    return jobs;
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      logger.error(
        { err: error.name, company: company.name, url: company.page },
        `${RED_CROSS} Error fetching Netflix jobs`
      );

      return [];
    }

    logger.error({ err: error, company: company.name }, `${RED_CROSS} Error fetching Netflix jobs`);

    return [];
  }
}
