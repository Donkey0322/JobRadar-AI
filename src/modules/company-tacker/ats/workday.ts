import z from "zod";

import { ABORT_SIGNAL } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { Company } from "../type";
import type { Job } from "@/types";

import { isTarget } from "../utils";

import { appendErrorLog } from "@/utils/data";
import { logger } from "@/utils/logger";
import { capitalize } from "@/utils/string";

const PAGE_SIZE = 20;
const MAX_PAGES = 20;

const identifierMap = {
  talentmanagementsolution: "jonas",
} satisfies Record<string, string>;

export function urlToWorkdayCompany(url: URL): Company {
  const host = url.hostname;
  const parts = url.pathname.split("/").filter(Boolean);

  const isLocale = (str: string) => /^[a-z]{2}-[a-z]{2}$/i.test(str);

  let name: string;
  let careerPage: string;

  if (host.endsWith("myworkdaysite.com")) {
    const recruitingIndex = parts.findIndex((p) => p.toLowerCase() === "recruiting");

    name = parts[recruitingIndex + 1];
    careerPage = parts[recruitingIndex + 2];

    if (!name || !careerPage) {
      throw new Error(`Invalid Workday site URL: ${url.toString()}`);
    }
  } else {
    name = host.split(".")[0];

    const jobIndex = parts.findIndex((p) => p.toLowerCase() === "job");

    careerPage =
      jobIndex > 0 ? parts[jobIndex - 1] : (parts.find((p) => !isLocale(p)) ?? "external");
  }

  const identifier = identifierMap[name as keyof typeof identifierMap] ?? name;
  const normalizedCareerPage = careerPage.toLowerCase();

  const domain = host.endsWith("myworkdaysite.com")
    ? `${url.origin}/recruiting/${name}/${careerPage}`
    : `${url.origin}/${careerPage}`;

  return {
    name: identifier,
    ats: "workday",
    identifier: `${identifier}-${normalizedCareerPage}`,
    domain,
    page: `${url.origin}/wday/cxs/${name}/${careerPage}/jobs`,
    urls: [],
  };
}

export const WorkdayJobSchema = z.object({
  title: z.string(),
  postedOn: z.string().optional(),
  locationsText: z.string().optional(),
  externalPath: z.string(),
});

type WorkdayJob = z.infer<typeof WorkdayJobSchema>;

export const WorkdayResponseSchema = z.object({
  jobPostings: z.array(WorkdayJobSchema),
});

function getWorkdayJobsFromResponse(data: unknown): WorkdayJob[] {
  const parsed = WorkdayResponseSchema.safeParse(data);

  if (!parsed.success) {
    logger.error({ data, issues: parsed.error.issues }, `${RED_CROSS} Invalid Workday response`);

    return [];
  }

  return parsed.data.jobPostings;
}

function normalizeWorkdayJob(job: WorkdayJob, company: Company): Job {
  return {
    company: capitalize(company.name),
    role: job.title,
    link: `${company.domain}${job.externalPath}`,
    location: job.locationsText ?? "",
  };
}

export async function fetchWorkday(
  company: Company,
  urls: Set<string>,
  signal: AbortSignal = ABORT_SIGNAL
) {
  let offset = 0;

  let page = 0;

  let hasMore = true;

  const results: WorkdayJob[] = [];

  try {
    while (hasMore && page < MAX_PAGES) {
      // already aborted
      if (signal.aborted) {
        logger.warn(
          {
            company: company.name,
          },
          "⚠️ Workday aborted before fetch"
        );

        return [];
      }

      const res = await fetch(company.page, {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          appliedFacets: {},
          limit: PAGE_SIZE,
          offset,
        }),

        signal,
      });

      if (!res.ok) {
        await appendErrorLog(`Workday: ${company.name} - ${res.status} - ${res.statusText}`);

        return [];
      }

      // JSON parse profiling
      const jsonStart = Date.now();

      // parse JSON error handling
      let data;
      try {
        data = await res.json();
      } catch {
        logger.error(
          { company: company.name, url: company.page },
          `${RED_CROSS} Workday JSON parse error`
        );
        return [];
      }

      const jsonDuration = Date.now() - jsonStart;

      // detect huge JSON parse stalls
      if (jsonDuration > 5000) {
        logger.warn(
          {
            company: company.name,
            duration: `${jsonDuration}ms`,
            offset,
            page,
          },
          "🐢 Slow Workday JSON parse"
        );
      }

      const rawJobs = getWorkdayJobsFromResponse(data);

      // empty page
      if (rawJobs.length === 0) {
        break;
      }

      results.push(...rawJobs);

      offset += PAGE_SIZE;
      page++;
      hasMore =
        rawJobs.length === PAGE_SIZE &&
        (!rawJobs[rawJobs.length - 1]?.postedOn ||
          rawJobs[rawJobs.length - 1]?.postedOn === "Posted Today");
    }

    // infinite pagination protection
    if (page >= MAX_PAGES) {
      logger.warn(
        {
          company: company.name,
          pages: page,
        },
        "⚠️ Workday hit MAX_PAGES limit"
      );
    }
  } catch (error) {
    // timeout / abort
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      logger.warn(
        {
          company: company.name,
          url: company.page,
        },
        "⚠️ Workday request aborted"
      );

      return [];
    }

    if (error instanceof Error && error.message === "Workday JSON parse error") {
      // logger.error(
      //   {
      //     company: company.name,
      //     url: company.page,
      //   },
      //   "⚠️ Workday JSON parse error"
      // );

      return [];
    }

    logger.error(
      {
        err: error,
        company: company.name,
        url: company.page,
      },
      `${RED_CROSS} Error fetching workday jobs`
    );

    return [];
  }

  const opportunities = results
    .filter((job) => isTarget(job.title) && !urls.has(`${company.domain}${job.externalPath}`))
    .map((job) => normalizeWorkdayJob(job, company));

  return opportunities;
}
