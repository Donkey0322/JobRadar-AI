import z from "zod";

import { RED_CROSS } from "@/constants/log";

import type { Company, Job } from "@/types";

import { Board } from "../employer";

import { getJobKey } from "@/modules/ats/job-key";
import { isWorkdayLocaleSegment } from "@/modules/ats/workday";
import { logListingFailure, logListingStatus } from "@/modules/employer/failure";
import { type ListingScan,listingTargetsFound } from "@/modules/employer/listing-scan";
import { formatCompanyName } from "@/utils/company-name";
import { logger } from "@/utils/logger";

const PAGE_SIZE = 20;
const MAX_PAGES = 20;
const MAX_LIST_PAGES = 80;

const identifierMap = {
  talentmanagementsolution: "jonas",
  globalhr: "rtx",
} satisfies Record<string, string>;

/** Career hosts replace `_` with `-`. The CXS path still wants the tenant underscore. */
function workdayTenant(name: string): string {
  return name.replaceAll("-", "_");
}

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

export class WorkdayBoard extends Board<WorkdayJob> {
  readonly ats = "workday" as const;

  companyKeyFromUrl(url: URL): string {
    const { companyName, careerPage } = this.getCompanyParts(url);
    return this.keyOf(`${companyName}-${careerPage.toLowerCase()}`);
  }

  formCompany(url: URL): Company {
    const { name, careerPage, companyName, domain } = this.getCompanyParts(url);

    return {
      name: companyName,
      ats: this.ats,
      identifier: `${companyName}-${careerPage.toLowerCase()}`,
      domain,
      page: `${url.origin}/wday/cxs/${workdayTenant(name)}/${careerPage}/jobs`,
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
      company: formatCompanyName(company.name),
      role: job.title,
      link: this.getJobLink(job, company),
      location: job.locationsText ?? "",
    };
  }

  protected async collectListingJobs(
    company: Company,
    signal: AbortSignal,
    scan?: ListingScan
  ): Promise<WorkdayJob[] | null> {
    return this.paginateJobPostings(company, signal, {
      recentOnly: false,
      maxPages: MAX_LIST_PAGES,
      scan,
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

    return this.screen(
      results.map((job) => this.posting(job, company)),
      knownKeys
    ).map((posting) => posting.toJob());
  }

  private async paginateJobPostings(
    company: Company,
    signal: AbortSignal,
    options: { recentOnly: boolean; maxPages: number; scan?: ListingScan }
  ): Promise<WorkdayJob[] | null> {
    const { recentOnly, maxPages } = options;
    let offset = 0;
    let page = 0;
    let hasMore = true;
    // Discovery only. One full page of older jobs can sit between hits.
    // A second consecutive full page with no dated hit stops the walk.
    let staleFullPages = 0;
    const results: WorkdayJob[] = [];
    const found = new Set<string>();
    const collected = (): WorkdayJob[] | null => (results.length > 0 ? results : null);

    try {
      while (hasMore && page < maxPages) {
        if (signal.aborted) {
          logger.warn(
            {
              company: company.name,
            },
            "⚠️ Workday aborted before fetch"
          );

          return collected();
        }

        options.scan?.onPage?.();
        const res = await fetch(company.page, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept-Language": "en-US",
          },
          body: JSON.stringify({
            appliedFacets: {},
            limit: PAGE_SIZE,
            offset,
          }),
          signal,
        });

        if (!res.ok) {
          await logListingStatus("Workday", company, res);
          return collected();
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
          return collected();
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

        // Date hits are counted before fetch() applies title and known-key screening.
        const accepted = recentOnly
          ? rawJobs.filter((job) => !job.postedOn || job.postedOn === "Posted Today")
          : rawJobs;
        results.push(...accepted);

        if (options.scan?.targetKeys?.size) {
          for (const job of accepted) {
            const link = this.getJobLink(job, company);
            if (link) found.add(getJobKey(link));
          }
        }

        offset += PAGE_SIZE;
        page++;
        const fullPage = rawJobs.length === PAGE_SIZE;
        if (!fullPage) {
          hasMore = false;
        } else if (recentOnly) {
          if (accepted.length > 0) staleFullPages = 0;
          else staleFullPages++;
          hasMore = staleFullPages < 2;
        }
        if (listingTargetsFound(found, options.scan)) {
          hasMore = false;
        }
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
      if (await logListingFailure("Workday", company, error)) {
        return collected();
      }

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

        return collected();
      }

      logger.error(
        {
          err: error,
          company: company.name,
          url: company.page,
        },
        `${RED_CROSS} Error fetching workday jobs`
      );

      return collected();
    }
  }
}

export const workdayBoard = new WorkdayBoard();
