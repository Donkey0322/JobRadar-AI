import z from "zod";

import { SMART_RECRUITERS_API_URL } from "@/constants/ats";
import { RED_CROSS } from "@/constants/log";

import type { Company } from "../type";
import type { Job } from "@/types";

import { isTarget, withinDays } from "../utils";

import { appendErrorLog } from "@/utils/data";
import { logger } from "@/utils/logger";
import { capitalize } from "@/utils/string";

export const SmartRecruitersJobSchema = z.object({
  id: z.string(),
  name: z.string(),
  company: z.object({ name: z.string() }).optional(),
  releasedDate: z.string(),
  location: z.object({ fullLocation: z.string().optional() }).optional(),
});

type SmartRecruitersJob = z.infer<typeof SmartRecruitersJobSchema>;

export const SmartRecruitersResponseSchema = z.object({
  content: z.array(SmartRecruitersJobSchema),
});

function getSmartRecruitersJobsFromResponse(data: unknown): SmartRecruitersJob[] {
  const parsed = SmartRecruitersResponseSchema.safeParse(data);

  if (!parsed.success) {
    logger.error(
      { data, issues: parsed.error.issues },
      `${RED_CROSS} Invalid SmartRecruiters response`
    );

    return [];
  }

  return parsed.data.content;
}

function normalizeSmartRecruitersJob(job: SmartRecruitersJob, company: Company): Job {
  return {
    company: capitalize(job.company?.name ?? ""),
    role: job.name,
    link: `${company.domain}/${company.name}/${job.id}`,
    location: job.location?.fullLocation ?? "",
  };
}

export function urlToSmartRecruitersCompany(url: URL): Company {
  const parts = url.pathname.split("/").filter(Boolean);
  const identifier = parts[0];

  return {
    name: identifier,
    ats: "smartrecruiters",
    identifier,
    domain: url.origin,
    page: `${SMART_RECRUITERS_API_URL}/${identifier}/postings`,
    urls: [],
  };
}

export async function fetchSmartRecruiters(
  company: Company,
  urls: Set<string>,
  signal: AbortSignal
) {
  try {
    const res = await fetch(company.page, {
      signal,
    });

    if (!res.ok) {
      await appendErrorLog(`Smart Recruiters: ${company.name} - ${res.status} - ${res.statusText}`);
      return [];
    }

    const rawJobs = getSmartRecruitersJobsFromResponse(await res.json());

    const opportunities = rawJobs
      .filter(
        (job) =>
          isTarget(job.name) &&
          !urls.has(`${company.domain}/${company.name}/${job.id}`) &&
          withinDays(job.releasedDate)
      )
      .map((job) => normalizeSmartRecruitersJob(job, company));

    return opportunities;
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      logger.warn(
        {
          company: company.name,
          url: company.page,
        },
        "⚠️ SmartRecruiters request aborted"
      );

      return [];
    }

    logger.error(
      {
        error,
        company: company.name,
      },
      `${RED_CROSS} Error fetching smart recruiters jobs`
    );

    return [];
  }
}
