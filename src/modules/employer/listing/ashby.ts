import pLimit from "p-limit";
import z from "zod";

import { ASHBY_API_URL } from "@/constants/ats";
import { RED_CROSS } from "@/constants/log";

import type { Company, Job } from "@/types";

import { Employer } from "../employer";

import {
  ashbyBoardOverride,
  ashbyHostedJobUrl,
  ashbySyncIdentifier,
  fetchAshbyBoardPostings,
  fetchAshbyPublishedDate,
  resolveAshbyIdentifier,
} from "@/modules/ats/ashby";
import { logListingFailure } from "@/modules/employer/failure";
import { errorLog } from "@/store";
import { logger } from "@/utils/logger";
import { formatCompanyName } from "@/utils/string";
import { getHostnameWithoutWww } from "@/utils/url";

function buildCompany(url: URL, identifier: string, name = identifier): Company {
  return {
    name,
    ats: "ashby",
    identifier,
    domain: url.origin,
    page: `${ASHBY_API_URL}/${identifier}`,
    urls: [],
  };
}

export const AshbyJobSchema = z.object({
  id: z.string(),
  title: z.string(),
  location: z.string().optional(),
  jobUrl: z.string(),
  publishedAt: z.string(),
});

export type AshbyJob = z.infer<typeof AshbyJobSchema>;

export const AshbyResponseSchema = z.object({
  jobs: z.array(AshbyJobSchema),
});

const PUBLISHED_DATE_CONCURRENCY = 8;

export class AshbyFetcher extends Employer<AshbyJob> {
  readonly ats = "ashby" as const;

  companyKeyFromUrl(url: URL): string {
    const syncIdentifier = this.getSyncIdentifier(url);

    if (syncIdentifier) {
      return this.companyKey(syncIdentifier);
    }

    return this.companyKey(`host:${getHostnameWithoutWww(url)}`);
  }

  async formCompany(url: URL): Promise<Company> {
    const override = ashbyBoardOverride(getHostnameWithoutWww(url));
    if (override) {
      return buildCompany(url, override.identifier, override.name);
    }

    return buildCompany(url, await resolveAshbyIdentifier(url));
  }

  /**
   * Identifier known from the URL alone (no network).
   * Returns null when HTML scrape is required.
   */
  private getSyncIdentifier(url: URL): string | null {
    return ashbySyncIdentifier(url);
  }

  protected getJobsFromResponse(data: unknown): AshbyJob[] {
    const parsed = AshbyResponseSchema.safeParse(data);

    if (!parsed.success) {
      logger.error({ data, issues: parsed.error.issues }, `${RED_CROSS} Invalid Ashby response`);

      return [];
    }

    return parsed.data.jobs;
  }

  protected getJobLink(job: AshbyJob, _company: Company): string {
    void _company;
    return job.jobUrl;
  }

  protected normalizeJob(job: AshbyJob, company: Company): Job {
    return {
      company: formatCompanyName(company.name),
      role: job.title,
      link: this.getJobLink(job, company),
      location: job.location ?? "",
    };
  }

  protected async collectListingJobs(
    company: Company,
    signal: AbortSignal
  ): Promise<AshbyJob[] | null> {
    const res = await fetch(company.page, { signal });

    if (res.ok) {
      return this.getJobsFromResponse(await res.json());
    }

    const board = await fetchAshbyBoardPostings(company.identifier, signal);
    if (board) {
      return board.map((posting) => ({
        id: posting.id,
        title: posting.title,
        location: posting.location,
        jobUrl: ashbyHostedJobUrl(company.identifier, posting.id),
        publishedAt: "",
      }));
    }

    await errorLog.append(`Ashby: ${company.name} - ${res.status} - ${res.statusText}`);
    return null;
  }

  async fetch(
    company: Company,
    knownKeys: ReadonlySet<string>,
    signal: AbortSignal
  ): Promise<Job[]> {
    try {
      const rawJobs = await this.collectListingJobs(company, signal);
      if (!rawJobs) return [];

      const jobs = await this.attachPublishedDates(rawJobs, company, knownKeys, signal);

      return jobs
        .map((job) => this.posting(job, company, job.publishedAt))
        .filter(
          (posting) => posting.isTarget() && !posting.isKnown(knownKeys) && posting.isRecent()
        )
        .map((posting) => posting.toJob());
    } catch (error) {
      if (await logListingFailure("Ashby", company, error)) return [];

      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        logger.warn(
          {
            company: company.name,
            url: company.page,
          },
          "⚠️ Ashby request aborted"
        );

        return [];
      }

      logger.error(
        {
          error,
          company: company.name,
          url: company.page,
        },
        `${RED_CROSS} Error fetching ashby jobs`
      );

      return [];
    }
  }

  /**
   * Hosted-board rows have no publishedDate. Look it up only for titles that
   * can still become a discovery.
   */
  private async attachPublishedDates(
    jobs: AshbyJob[],
    company: Company,
    knownKeys: ReadonlySet<string>,
    signal: AbortSignal
  ): Promise<AshbyJob[]> {
    const pending = jobs.filter((job) => {
      if (job.publishedAt) return false;

      const posting = this.posting(job, company, job.publishedAt);
      return posting.isTarget() && !posting.isKnown(knownKeys);
    });

    if (pending.length === 0) return jobs;

    const dates = new Map<string, string>();
    const limit = pLimit(PUBLISHED_DATE_CONCURRENCY);

    await Promise.all(
      pending.map((job) =>
        limit(async () => {
          const date = await fetchAshbyPublishedDate(company.identifier, job.id, signal);
          if (date) dates.set(job.id, date);
        })
      )
    );

    return jobs.map((job) => {
      const date = dates.get(job.id);
      return date ? { ...job, publishedAt: date } : job;
    });
  }
}

export const ashbyFetcher = new AshbyFetcher();
