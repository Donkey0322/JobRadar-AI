import z from "zod";

import { RED_CROSS } from "@/constants/log";

import type { Company } from "../type";
import type { Job } from "@/types";

import { isTarget, withinDays } from "../utils";

import { appendErrorLog } from "@/utils/data";
import { logger } from "@/utils/logger";
import { capitalize } from "@/utils/string";

export const EightfoldJobSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  display_job_id: z.union([z.string(), z.number()]).optional(),
  name: z.string().optional(),
  title: z.string().optional(),
  position_name: z.string().optional(),
  location: z.string().optional(),
  locations: z.array(z.string()).optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  posted_date: z.union([z.string(), z.number()]).optional(),
  created_at: z.union([z.string(), z.number()]).optional(),
  updated_at: z.union([z.string(), z.number()]).optional(),
  t_create: z.union([z.string(), z.number()]).optional(),
});

type EightfoldJob = z.infer<typeof EightfoldJobSchema>;

export const EightfoldResponseSchema = z.object({
  positions: z.array(EightfoldJobSchema).optional(),
  jobs: z.array(EightfoldJobSchema).optional(),
  data: z
    .object({
      positions: z.array(EightfoldJobSchema).optional(),
      jobs: z.array(EightfoldJobSchema).optional(),
    })
    .optional(),
});


const PAGE_SIZE = 10;
const MAX_PAGES = 200;

export function urlToEightfoldCompany(url: URL): Company {
  const identifier = url.hostname.replace(".eightfold.ai", "");

  const domain = url.searchParams.get("domain") ?? `${identifier}.com`;

  return {
    name: identifier,
    ats: "eightfold",
    identifier,
    domain: url.origin,
    page: `${url.origin}/api/pcsx/search?domain=${domain}`,
    urls: [],
  };
}

function getEightfoldJobsFromResponse(data: unknown): EightfoldJob[] {
  const parsed = EightfoldResponseSchema.safeParse(data);

  if (!parsed.success) {
    logger.error(
      { data, issues: parsed.error.issues },
      `${RED_CROSS} Invalid Eightfold response`
    );

    return [];
  }

  return (
    parsed.data.positions ??
    parsed.data.jobs ??
    parsed.data.data?.positions ??
    parsed.data.data?.jobs ??
    []
  );
}

function normalizeEightfoldJob(job: EightfoldJob, company: Company): Job {
  const role = job.name ?? job.title ?? job.position_name ?? "";
  const id = job.id ?? job.display_job_id;
  const link = `${company.domain}/careers/job/${id}`;
  const location = Array.isArray(job.locations)
    ? job.locations.join(", ")
    : (job.location ?? [job.city, job.state, job.country].filter(Boolean).join(", "));

  return {
    company: capitalize(company.name),
    role,
    link,
    location,
  };
}

export async function fetchEightfold(
  company: Company,
  urls: Set<string>,
  signal: AbortSignal
): Promise<Job[]> {
  const allJobs: Job[] = [];

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const start = page * PAGE_SIZE;
      const url = new URL(company.page);

      url.searchParams.set("query", "");
      url.searchParams.set("location", "");
      url.searchParams.set("start", String(start));
      url.searchParams.set("sort_by", "timestamp");

      const res = await fetch(url.toString(), {
        signal,
        headers: {
          accept: "application/json, text/plain, */*",
          "accept-language": "en-US,en;q=0.9",
          referer: `${company.domain}/careers?start=${start}&sort_by=timestamp`,
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
        },
      });

      if (!res.ok) {
        await appendErrorLog(`Eightfold: ${company.name} - ${res.status} - ${res.statusText}`);
        break;
      }

      const rawJobs = getEightfoldJobsFromResponse(await res.json());

      if (rawJobs.length === 0) break;

      let reachedOldJob = false;

      const opportunities = rawJobs
        .filter((job) => {
          const postedDate = job.posted_date ?? job.created_at ?? job.t_create ?? job.updated_at;

          if (postedDate && !withinDays(postedDate)) {
            reachedOldJob = true;
            return false;
          }

          const id = job.id ?? job.display_job_id;
          const role = job.name ?? job.title ?? job.position_name ?? "";
          const link = id ? `${company.domain}/careers/job/${id}` : null;

          return !!(role && link && isTarget(role) && !urls.has(link));
        })
        .map((job) => normalizeEightfoldJob(job, company));

      allJobs.push(...opportunities);

      if (rawJobs.length < PAGE_SIZE || reachedOldJob) break;
    }

    return allJobs;
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      logger.warn(
        {
          company: company.name,
          url: company.page,
        },
        "⚠️ Eightfold request aborted"
      );

      return [];
    }

    logger.error(
      {
        error,
        company: company.name,
        url: company.page,
      },
      `${RED_CROSS} Error fetching eightfold jobs`
    );

    return [];
  }
}
