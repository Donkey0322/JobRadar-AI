import z from "zod";

import { GREENHOUSE_API_URL } from "@/constants/ats";
import { RED_CROSS } from "@/constants/log";

import type { Company, Job } from "@/types";

import { Employer } from "../employer";

import {
  greenhouseSyncIdentifier,
  isGreenhouseJobBoardHost,
  resolveGreenhouseIdentifier,
} from "@/modules/ats/greenhouse";
import { logListingStatus } from "@/modules/employer/failure";
import { formatCompanyName } from "@/utils/company-name";
import { logger } from "@/utils/logger";
import { getHostnameWithoutWww } from "@/utils/url";

export const GreenhouseJobSchema = z.object({
  company_name: z.string().optional(),
  title: z.string(),
  absolute_url: z.string(),
  first_published: z.string().nullish(),
  updated_at: z.string(),
  location: z.object({ name: z.string().nullish() }).optional(),
});

export type GreenhouseJob = z.infer<typeof GreenhouseJobSchema>;

export const GreenhouseResponseSchema = z.object({
  jobs: z.array(GreenhouseJobSchema),
});

export class GreenhouseFetcher extends Employer<GreenhouseJob> {
  readonly ats = "greenhouse" as const;

  companyKeyFromUrl(url: URL): string {
    const syncIdentifier = this.getSyncIdentifier(url);

    if (syncIdentifier) {
      return this.keyOf(syncIdentifier);
    }

    const parts = url.pathname.split("/").filter(Boolean);
    const host = getHostnameWithoutWww(url);

    // Provisional keys for URLs that need network to resolve the real identifier
    if (isGreenhouseJobBoardHost(host) && parts[0] === "embed" && parts[1] === "job_app") {
      const token = url.searchParams.get("token");
      return this.keyOf(token ? `job_app:${token}` : `url:${url.href}`);
    }

    return this.keyOf(`host:${host}`);
  }

  async formCompany(url: URL): Promise<Company> {
    return this.buildCompany(url, await resolveGreenhouseIdentifier(url));
  }

  /**
   * Identifier known from the URL alone (no network).
   * Returns null when HTML scrape / redirect is required.
   */
  private getSyncIdentifier(url: URL): string | null {
    return greenhouseSyncIdentifier(url);
  }

  protected getJobsFromResponse(data: unknown): GreenhouseJob[] {
    const parsed = GreenhouseResponseSchema.safeParse(data);

    if (!parsed.success) {
      logger.error(
        { data, issues: parsed.error.issues },
        `${RED_CROSS} Invalid Greenhouse response`
      );
      return [];
    }

    return parsed.data.jobs;
  }

  protected getJobLink(job: GreenhouseJob, _company: Company): string {
    void _company;
    return job.absolute_url;
  }

  protected normalizeJob(job: GreenhouseJob, company: Company): Job {
    return {
      company: formatCompanyName(job.company_name ?? company.name),
      role: job.title,
      link: this.getJobLink(job, company),
      location: job.location?.name ?? "",
    };
  }

  async fetch(
    company: Company,
    knownKeys: ReadonlySet<string>,
    signal: AbortSignal
  ): Promise<Job[]> {
    try {
      const response = await fetch(company.page, { signal });

      if (!response.ok) {
        await logListingStatus("Greenhouse", company, response);
        return [];
      }

      return this.screen(
        this.getJobsFromResponse(await response.json()).map((job) =>
          this.posting(job, company, [job.first_published, job.updated_at])
        ),
        knownKeys,
        { recent: true }
      ).map((posting) => posting.toJob());
    } catch (error) {
      return this.failSoft("Greenhouse", company, error);
    }
  }

  private buildCompany(url: URL, identifier: string): Company {
    return {
      name: identifier,
      ats: this.ats,
      identifier,
      domain: url.origin,
      page: `${GREENHOUSE_API_URL}/${identifier}/jobs`,
      urls: [],
    };
  }
}

export const greenhouseFetcher = new GreenhouseFetcher();

/**
 * {
    "name": "sofi",
    "ats": "greenhouse",
    "identifier": "sofi",
    "domain": "https://sofi.com",
    "page": "https://boards-api.greenhouse.io/v1/boards/sofi/jobs",
    "urls": [
      "https://sofi.com/careers/job/7565483003?gh_jid=7565483003"
    ]
  },
  {
    "name": "sofiuniversity",
    "ats": "greenhouse",
    "identifier": "sofiuniversity",
    "domain": "https://www.sofi.com",
    "page": "https://boards-api.greenhouse.io/v1/boards/sofiuniversity/jobs",
    "urls": [
      "https://www.sofi.com/careers/sofi-university/7581448003?gh_jid=7581448003",
      "https://www.sofi.com/careers/sofi-university/7581753003?gh_jid=7581753003",
      "https://www.sofi.com/careers/sofi-university/7585152003?gh_jid=7585152003",
      "https://www.sofi.com/careers/sofi-university/7595648003?gh_jid=7595648003",
      "https://www.sofi.com/careers/sofi-university/7600784003?gh_jid=7600784003",
      "https://www.sofi.com/careers/sofi-university/7616239003?gh_jid=7616239003",
      "https://www.sofi.com/careers/sofi-university/7637277003?gh_jid=7637277003",
      "https://www.sofi.com/careers/sofi-university/?gh_jid=7575833003&gh_src=d50e8f9b3us"
    ]
  },
 */
