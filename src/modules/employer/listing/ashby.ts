import z from "zod";

import { ASHBY_API_URL } from "@/constants/ats";
import { RED_CROSS } from "@/constants/log";

import type { Company, Job } from "@/types";

import { Employer } from "../employer";
import { ashbyBoardOverride, ashbySyncIdentifier, isAshbyJobBoardHost, resolveAshbyIdentifier } from "../shared/ashby";

import { appendErrorLog } from "@/utils/data";
import { logger } from "@/utils/logger";
import { capitalize } from "@/utils/string";
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

export function isAshbyUrl(url: URL): boolean {
  const host = getHostnameWithoutWww(url);

  return (
    isAshbyJobBoardHost(host) || host.includes("ashbyhq.com") || url.searchParams.has("ashby_jid")
  );
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
      company: capitalize(company.name),
      role: job.title,
      link: this.getJobLink(job, company),
      location: job.location ?? "",
    };
  }

  async fetch(
    company: Company,
    knownKeys: ReadonlySet<string>,
    signal: AbortSignal
  ): Promise<Job[]> {
    try {
      const res = await fetch(company.page, {
        signal,
      });

      if (!res.ok) {
        await appendErrorLog(`Ashby: ${company.name} - ${res.status} - ${res.statusText}`);
        return [];
      }

      const rawJobs = this.getJobsFromResponse(await res.json());

      const opportunities = rawJobs
        .map((job) => this.posting(job, company, job.publishedAt))
        .filter(
          (posting) => posting.isTarget() && !posting.isKnown(knownKeys) && posting.isRecent()
        )
        .map((posting) => posting.toJob());

      return opportunities;
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

}

export const ashbyFetcher = new AshbyFetcher();
