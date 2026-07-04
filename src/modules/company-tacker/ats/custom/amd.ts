import z from "zod";

import { ABORT_SIGNAL } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { Company } from "@/modules/company-tacker/type";
import type { Job } from "@/types";

import { isTarget } from "../../utils";

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

interface AMDJobItem {
  data: AMDJob;
}

interface AMDResponse {
  jobs: AMDJobItem[];
}

const MAX_PAGES = 10;

function getAMDJobsFromResponse(response: AMDResponse): AMDJob[] {
  return response.jobs.map((item) => item.data);
}

function isPostedToday(postedDate?: string): boolean {
  if (!postedDate) return false;

  const today = new Date().toISOString().slice(0, 10);
  const postedDay = new Date(postedDate).toISOString().slice(0, 10);

  return postedDay === today;
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
    const allJobs: Job[] = [];

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

      const response = (await res.json()) as AMDResponse;
      const rawJobs = getAMDJobsFromResponse(response);
      if (rawJobs.length === 0) {
        break;
      }

      let hasNonTodayJob = false;

      for (const rawJob of rawJobs) {
        const parsed = AMDJobSchema.safeParse(rawJob);

        if (!parsed.success) {
          logger.error(
            { job: rawJob, issues: parsed.error.issues },
            `${RED_CROSS} Invalid AMD job`
          );

          continue;
        }

        const amdJob = parsed.data;

        if (!isPostedToday(amdJob.posted_date)) {
          hasNonTodayJob = true;
          continue;
        }

        const link = `${AMD_JOB_URL}/${amdJob.req_id}`;

        if (!isTarget(amdJob.title) || urls.has(link)) {
          continue;
        }

        allJobs.push(normalizeAMDJob(amdJob));
      }

      if (hasNonTodayJob) {
        break;
      }
    }

    return allJobs;
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
