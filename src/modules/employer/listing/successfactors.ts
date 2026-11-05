import { RED_CROSS } from "@/constants/log";

import type { Company, Job } from "@/types";

import { Employer } from "../employer";

import {
  getSuccessFactorsFeedCompanyName,
  getSuccessFactorsFeedUrl,
  parseSuccessFactorsFeed,
  successFactorsCompanyName,
  type SuccessFactorsJob,
} from "@/modules/ats/successfactors";
import { logListingFailure, logListingStatus } from "@/modules/employer/failure";
import { formatCompanyName } from "@/utils/company-name";
import { isAbortError } from "@/utils/http";
import { logger } from "@/utils/logger";
import { getHostnameWithoutWww } from "@/utils/url";

export type { SuccessFactorsJob } from "@/modules/ats/successfactors";

const FEED_HEADERS: HeadersInit = {
  accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
  "user-agent": "Mozilla/5.0 (JobRadar)",
};

async function fetchFeed(url: string, signal: AbortSignal): Promise<Response> {
  return fetch(url, { signal, headers: FEED_HEADERS });
}

async function fetchFeedCompanyName(feedUrl: string): Promise<string | null> {
  try {
    const res = await fetchFeed(feedUrl, AbortSignal.timeout(15_000));
    if (!res.ok) return null;
    return getSuccessFactorsFeedCompanyName(await res.text());
  } catch {
    return null;
  }
}

/**
 * SAP SuccessFactors Career Site Builder boards. The public RSS feed lists the
 * newest postings first and does not paginate.
 */
export class SuccessFactorsFetcher extends Employer<SuccessFactorsJob> {
  readonly ats = "successfactors" as const;

  companyKeyFromUrl(url: URL): string {
    return this.keyOf(getHostnameWithoutWww(url));
  }

  async formCompany(url: URL): Promise<Company> {
    const page = getSuccessFactorsFeedUrl(url);
    const feedName = await fetchFeedCompanyName(page);

    return {
      name: successFactorsCompanyName(feedName, url),
      ats: this.ats,
      identifier: getHostnameWithoutWww(url),
      domain: url.origin,
      page,
      urls: [],
    };
  }

  protected getJobsFromResponse(data: unknown): SuccessFactorsJob[] {
    return typeof data === "string" ? parseSuccessFactorsFeed(data) : [];
  }

  protected getJobLink(job: SuccessFactorsJob, _company: Company): string {
    void _company;
    return job.link;
  }

  protected normalizeJob(job: SuccessFactorsJob, company: Company): Job {
    return {
      company: formatCompanyName(company.name),
      role: job.title,
      link: this.getJobLink(job, company),
      location: job.location,
    };
  }

  protected async collectListingJobs(
    company: Company,
    signal: AbortSignal
  ): Promise<SuccessFactorsJob[] | null> {
    const res = await fetchFeed(company.page, signal);
    if (!res.ok) return null;
    return this.getJobsFromResponse(await res.text());
  }

  async fetch(
    company: Company,
    knownKeys: ReadonlySet<string>,
    signal: AbortSignal
  ): Promise<Job[]> {
    try {
      const res = await fetchFeed(company.page, signal);

      if (!res.ok) {
        await logListingStatus("SuccessFactors", company, res);
        return [];
      }

      return this.screen(
        this.getJobsFromResponse(await res.text()).map((job) =>
          this.posting(job, company, job.postedDate)
        ),
        knownKeys,
        { recent: true }
      ).map((posting) => posting.toJob());
    } catch (error) {
      if (await logListingFailure("SuccessFactors", company, error)) return [];

      logger.error(
        {
          err: isAbortError(error) ? error.name : error,
          company: company.name,
          url: company.page,
        },
        `${RED_CROSS} Error fetching SuccessFactors jobs`
      );

      return [];
    }
  }
}

export const successFactorsFetcher = new SuccessFactorsFetcher();
