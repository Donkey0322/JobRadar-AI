import { ABORT_SIGNAL } from "@/constants";

import type { Company } from "@/modules/company-tacker/type";
import type { Job } from "@/types";

import { isTarget } from "../../utils";

interface AMDJob {
  req_id: string;
  title: string;
  full_location?: string;
  short_location?: string;
  location_name?: string;
  city?: string;
  state?: string;
  country?: string;
  posted_date?: string;
}

interface AMDJobItem {
  data: AMDJob;
}

interface AMDResponse {
  jobs: AMDJobItem[];
}

const MAX_PAGES = 10;

function getAMDJobLink(job: AMDJob): string {
  return `https://careers.amd.com/careers-home/jobs/${job.req_id}?lang=en-us`;
}

function getAMDJobLocation(job: AMDJob): string {
  if (job.full_location) return job.full_location;
  if (job.short_location) return job.short_location;
  if (job.location_name) return job.location_name;

  return [job.city, job.state, job.country].filter(Boolean).join(", ");
}

function isPostedToday(postedDate?: string): boolean {
  if (!postedDate) return false;

  const today = new Date().toISOString().slice(0, 10);
  const postedDay = new Date(postedDate).toISOString().slice(0, 10);

  return postedDay === today;
}

export async function fetchAMD(
  company: Company,
  urls: Set<string>,
  signal: AbortSignal = ABORT_SIGNAL
): Promise<Job[]> {
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

    const jobs = response.jobs.map((item) => item.data);

    if (jobs.length === 0) {
      break;
    }

    const todayJobs = jobs.filter((job) => isPostedToday(job.posted_date));
    const pageJobs: Job[] = todayJobs.map((job) => ({
      company: "AMD",
      role: job.title,
      location: getAMDJobLocation(job),
      link: getAMDJobLink(job),
    }));

    allJobs.push(...pageJobs);

    if (todayJobs.length < jobs.length) {
      break;
    }
  }

  return allJobs.filter((job) => isTarget(job.role) && !urls.has(job.link));
}
