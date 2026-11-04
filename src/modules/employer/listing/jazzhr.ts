import { RED_CROSS } from "@/constants/log";

import type { Company, Job } from "@/types";

import { Employer } from "../employer";

import {
  jazzHRHostName,
  type JazzHRJob,
  jazzHRJobUrl,
  jazzHRListingUrl,
  parseJazzHRCompanyName,
  parseJazzHRListing,
} from "@/modules/ats/jazzhr";
import { logListingFailure, logListingStatus } from "@/modules/employer/failure";
import { isAbortError } from "@/utils/http";
import { logger } from "@/utils/logger";
import { formatCompanyName } from "@/utils/string";
import { getHostnameWithoutWww } from "@/utils/url";

export type { JazzHRJob } from "@/modules/ats/jazzhr";

const PAGE_HEADERS: HeadersInit = {
  "user-agent": "Mozilla/5.0 (JobRadar)",
};

async function fetchListing(url: string, signal: AbortSignal): Promise<Response> {
  return fetch(url, { signal, headers: PAGE_HEADERS });
}

async function fetchCompanyName(listingUrl: string): Promise<string | null> {
  try {
    const res = await fetchListing(listingUrl, AbortSignal.timeout(15_000));
    if (!res.ok) return null;
    return parseJazzHRCompanyName(await res.text());
  } catch {
    return null;
  }
}

/**
 * JazzHR boards (`*.applytojob.com` or a company domain). `/apply/jobs` renders
 * every open job in one HTML table; there is no public JSON feed.
 */
export class JazzHRFetcher extends Employer<JazzHRJob> {
  readonly ats = "jazzhr" as const;

  companyKeyFromUrl(url: URL): string {
    return this.companyKey(getHostnameWithoutWww(url));
  }

  async formCompany(url: URL): Promise<Company> {
    const page = jazzHRListingUrl(url);

    return {
      name: (await fetchCompanyName(page)) ?? jazzHRHostName(url),
      ats: this.ats,
      identifier: getHostnameWithoutWww(url),
      domain: url.origin,
      page,
      urls: [],
    };
  }

  protected getJobsFromResponse(data: unknown): JazzHRJob[] {
    return typeof data === "string" ? parseJazzHRListing(data) : [];
  }

  protected getJobLink(job: JazzHRJob, company: Company): string {
    return jazzHRJobUrl(company.domain, job.jobId);
  }

  protected normalizeJob(job: JazzHRJob, company: Company): Job {
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
  ): Promise<JazzHRJob[] | null> {
    const res = await fetchListing(company.page, signal);
    if (!res.ok) return null;
    return this.getJobsFromResponse(await res.text());
  }

  async fetch(
    company: Company,
    knownKeys: ReadonlySet<string>,
    signal: AbortSignal
  ): Promise<Job[]> {
    try {
      const res = await fetchListing(company.page, signal);

      if (!res.ok) {
        await logListingStatus("JazzHR", company, res);
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
      if (await logListingFailure("JazzHR", company, error)) return [];

      logger.error(
        {
          err: isAbortError(error) ? error.name : error,
          company: company.name,
          url: company.page,
        },
        `${RED_CROSS} Error fetching JazzHR jobs`
      );

      return [];
    }
  }
}

export const jazzHRFetcher = new JazzHRFetcher();
