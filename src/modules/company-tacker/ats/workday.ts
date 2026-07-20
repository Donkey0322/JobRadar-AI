import z from "zod";

import { RED_CROSS } from "@/constants/log";

import type { Company } from "../type";
import type { Job } from "@/types";

import { isTarget } from "../utils";

import { ATSFetcher } from "./class";

import { isWorkdayLocaleSegment } from "@/modules/shared/ats/workday";
import { appendErrorLog } from "@/utils/data";
import { logger } from "@/utils/logger";
import { capitalize } from "@/utils/string";

const PAGE_SIZE = 20;
const MAX_PAGES = 20;

const identifierMap = {
  talentmanagementsolution: "jonas",
} satisfies Record<string, string>;

export const WorkdayJobSchema = z.object({
  title: z.string(),
  postedOn: z.string().optional(),
  locationsText: z.string().optional(),
  externalPath: z.string(),
});

export type WorkdayJob = z.infer<typeof WorkdayJobSchema>;

const WorkdayResponseSchema = z.object({
  jobPostings: z.array(z.unknown()),
});

export class WorkdayFetcher extends ATSFetcher<WorkdayJob> {
  readonly ats = "workday" as const;

  formCompany(url: URL): Company {
    const host = url.hostname;
    const parts = url.pathname.split("/").filter(Boolean);

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
        jobIndex > 0
          ? parts[jobIndex - 1]
          : (parts.find((p) => !isWorkdayLocaleSegment(p, "lenient")) ?? "external");
    }

    const identifier = identifierMap[name as keyof typeof identifierMap] ?? name;
    const normalizedCareerPage = careerPage.toLowerCase();

    const domain = host.endsWith("myworkdaysite.com")
      ? `${url.origin}/recruiting/${name}/${careerPage}`
      : `${url.origin}/${careerPage}`;

    return {
      name: identifier,
      ats: this.ats,
      identifier: `${identifier}-${normalizedCareerPage}`,
      domain,
      page: `${url.origin}/wday/cxs/${name}/${careerPage}/jobs`,
      urls: [],
    };
  }

  protected getJobsFromResponse(data: unknown): WorkdayJob[] {
    const response = WorkdayResponseSchema.safeParse(data);

    if (!response.success) {
      logger.error(
        {
          issues: response.error.issues,
        },
        `${RED_CROSS} Invalid Workday response structure`
      );

      return [];
    }

    const jobs: WorkdayJob[] = [];

    for (const [, rawJob] of response.data.jobPostings.entries()) {
      const parsedJob = WorkdayJobSchema.safeParse(rawJob);

      if (!parsedJob.success) {
        continue;
      }

      jobs.push(parsedJob.data);
    }

    return jobs;
  }

  protected getJobLink(job: WorkdayJob, company: Company): string {
    return `${company.domain}${job.externalPath}`;
  }

  protected normalizeJob(job: WorkdayJob, company: Company): Job {
    return {
      company: capitalize(company.name),
      role: job.title,
      link: this.getJobLink(job, company),
      location: job.locationsText ?? "",
    };
  }

  async fetch(company: Company, urls: Set<string>, signal: AbortSignal): Promise<Job[]> {
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

        const rawJobs = this.getJobsFromResponse(data);

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
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
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
      .filter((job) => isTarget(job.title) && !urls.has(this.getJobLink(job, company)))
      .map((job) => this.normalizeJob(job, company));

    return opportunities;
  }
}

export const workdayFetcher = new WorkdayFetcher();
