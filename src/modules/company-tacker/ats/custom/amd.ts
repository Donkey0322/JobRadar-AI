import z from "zod";

import { ABORT_SIGNAL } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { Company } from "@/modules/company-tacker/type";
import type { Job } from "@/types";

import { isTarget, withinDays } from "../../utils";

import { logger } from "@/utils/logger";

const AMD_CAREERS_URL = "https://careers.amd.com/careers-home/jobs";
const AMD_JOB_URL = `${AMD_CAREERS_URL}?lang=en-us`;

export const AMDCompany = {
  name: "AMD",
  ats: "custom",
  identifier: "amd",
  domain: "https://careers.amd.com",
  page: AMD_CAREERS_URL,
  urls: [],
} as const satisfies Company;

export const AMDJobSchema = z.object({
  req_id: z.string(),
  title: z.string(),
  full_location: z.string().optional(),
  short_location: z.string().optional(),
  location_name: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  posted_date: z.string().optional(),
});

type AMDJob = z.infer<typeof AMDJobSchema>;

export const AMDResponseSchema = z.object({
  jobs: z.array(z.object({ data: AMDJobSchema })),
});

const MAX_PAGES = 10;

function getAMDJobsFromResponse(data: unknown): AMDJob[] {
  const parsed = AMDResponseSchema.safeParse(data);

  if (!parsed.success) {
    logger.error({ data, issues: parsed.error.issues }, `${RED_CROSS} Invalid AMD response`);

    return [];
  }

  return parsed.data.jobs.map((item) => item.data);
}

function normalizeAMDJob(job: AMDJob): Job {
  const location =
    job.full_location ??
    job.short_location ??
    job.location_name ??
    [job.city, job.state, job.country].filter(Boolean).join(", ");

  return {
    company: "AMD",
    role: job.title,
    link: `${AMD_JOB_URL}/${job.req_id}`,
    location,
  };
}

export async function fetchAMD(
  company: Company,
  urls: Set<string>,
  signal: AbortSignal = ABORT_SIGNAL
): Promise<Job[]> {
  try {
    const jobs: Job[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = new URL(company.page);

      url.pathname = "/api/jobs";
      url.searchParams.set("sortBy", "posted_date");
      url.searchParams.set("descending", "true");
      url.searchParams.set("page", String(page));
      url.searchParams.set("internal", "false");

      const res = await fetch(url.toString(), {
        signal,
        headers: {
          Accept: "application/json",
        },
      });

      if (!res.ok) {
        break;
      }

      const rawJobs = getAMDJobsFromResponse(await res.json());

      if (rawJobs.length === 0) {
        break;
      }

      let reachedOldJob = false;

      const opportunities = rawJobs
        .filter((job) => {
          if (!withinDays(job.posted_date)) {
            reachedOldJob = true;
            return false;
          }

          return isTarget(job.title) && !urls.has(`${AMD_JOB_URL}/${job.req_id}`);
        })
        .map(normalizeAMDJob);

      jobs.push(...opportunities);

      if (reachedOldJob) {
        break;
      }
    }

    return jobs;
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      logger.error(
        { err: error.name, company: company.name, url: company.page },
        `${RED_CROSS} Error fetching AMD jobs`
      );

      return [];
    }

    logger.error({ err: error, company: company.name }, `${RED_CROSS} Error fetching AMD jobs`);

    return [];
  }
}
