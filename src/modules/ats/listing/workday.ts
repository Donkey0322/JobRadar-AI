import z from "zod";

import { RED_CROSS } from "@/constants/log";

import type { Company, Job } from "@/types";

import { ATSFetcher } from "../core/fetcher";
import { isTarget } from "../core/filter";

import { isWorkdayLocaleSegment } from "@/modules/ats/shared/workday";
import { appendErrorLog } from "@/utils/data";
import { logger } from "@/utils/logger";
import { capitalize } from "@/utils/string";

const PAGE_SIZE = 20;
const MAX_PAGES = 20;
const MAX_LIST_PAGES = 80;

const identifierMap = {
  talentmanagementsolution: "jonas",
  globalhr: "rtx",
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

  companyKeyFromUrl(url: URL): string {
    const { companyName, careerPage } = this.getCompanyParts(url);
    return this.companyKey(`${companyName}-${careerPage.toLowerCase()}`);
  }

  formCompany(url: URL): Company {
    const { name, careerPage, companyName, domain } = this.getCompanyParts(url);

    return {
      name: companyName,
      ats: this.ats,
      identifier: `${companyName}-${careerPage.toLowerCase()}`,
      domain,
      page: `${url.origin}/wday/cxs/${name}/${careerPage}/jobs`,
      urls: [],
    };
  }

  private getCompanyParts(url: URL): {
    name: string;
    careerPage: string;
    companyName: string;
    domain: string;
  } {
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

    const companyName = identifierMap[name as keyof typeof identifierMap] ?? name;
    const domain = host.endsWith("myworkdaysite.com")
      ? `${url.origin}/recruiting/${name}/${careerPage}`
      : `${url.origin}/${careerPage}`;

    return {
      name,
      careerPage,
      companyName,
      domain,
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

  protected async collectListingJobs(
    company: Company,
    signal: AbortSignal
  ): Promise<WorkdayJob[] | null> {
    return this.paginateJobPostings(company, signal, {
      recentOnly: false,
      maxPages: MAX_LIST_PAGES,
    });
  }

  async fetch(
    company: Company,
    knownKeys: ReadonlySet<string>,
    signal: AbortSignal
  ): Promise<Job[]> {
    const results = await this.paginateJobPostings(company, signal, {
      recentOnly: true,
      maxPages: MAX_PAGES,
    });

    if (!results) {
      return [];
    }

    return results
      .filter(
        (job) => isTarget(job.title) && !this.isKnownJob(this.getJobLink(job, company), knownKeys)
      )
      .map((job) => this.normalizeJob(job, company));
  }

  private async paginateJobPostings(
    company: Company,
    signal: AbortSignal,
    options: { recentOnly: boolean; maxPages: number }
  ): Promise<WorkdayJob[] | null> {
    const { recentOnly, maxPages } = options;
    let offset = 0;
    let page = 0;
    let hasMore = true;
    const results: WorkdayJob[] = [];

    try {
      while (hasMore && page < maxPages) {
        if (signal.aborted) {
          logger.warn(
            {
              company: company.name,
            },
            "⚠️ Workday aborted before fetch"
          );

          return recentOnly ? null : results.length > 0 ? results : null;
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
          if (!recentOnly && results.length > 0) {
            return results;
          }
          return null;
        }

        const jsonStart = Date.now();
        let data;
        try {
          data = await res.json();
        } catch {
          logger.error(
            { company: company.name, url: company.page },
            `${RED_CROSS} Workday JSON parse error`
          );
          if (!recentOnly && results.length > 0) {
            return results;
          }
          return null;
        }

        const jsonDuration = Date.now() - jsonStart;
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
        if (rawJobs.length === 0) {
          break;
        }

        if (recentOnly) {
          results.push(
            ...rawJobs.filter((job) => !job.postedOn || job.postedOn === "Posted Today")
          );
        } else {
          results.push(...rawJobs);
        }

        offset += PAGE_SIZE;
        page++;
        hasMore =
          rawJobs.length === PAGE_SIZE &&
          (!recentOnly ||
            !rawJobs[rawJobs.length - 1]?.postedOn ||
            rawJobs[rawJobs.length - 1]?.postedOn === "Posted Today");
      }

      if (page >= maxPages) {
        logger.warn(
          {
            company: company.name,
            pages: page,
          },
          "⚠️ Workday hit MAX_PAGES limit"
        );
      }

      return results;
    } catch (error) {
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

        return recentOnly ? null : results.length > 0 ? results : null;
      }

      logger.error(
        {
          err: error,
          company: company.name,
          url: company.page,
        },
        `${RED_CROSS} Error fetching workday jobs`
      );

      return recentOnly ? null : results.length > 0 ? results : null;
    }
  }
}

export const workdayFetcher = new WorkdayFetcher();
