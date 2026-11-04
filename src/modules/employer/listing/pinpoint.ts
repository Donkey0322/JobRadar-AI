import { RED_CROSS } from "@/constants/log";

import type { Company, Job } from "@/types";

import { Employer } from "../employer";

import {
  fetchPinpointCompanyName,
  getPinpointSlug,
  pinpointJobUrl,
  pinpointListingUrl,
  type PinpointPosting,
  PinpointResponseSchema,
} from "@/modules/ats/pinpoint";
import { logListingFailure, logListingStatus } from "@/modules/employer/failure";
import { isAbortError } from "@/utils/http";
import { logger } from "@/utils/logger";
import { formatCompanyName } from "@/utils/string";

export type PinpointJob = PinpointPosting;

function formatLocation(job: PinpointJob): string {
  const place = job.location?.name?.trim() ?? "";
  if (job.workplace_type !== "remote") return place;
  return place ? `${place} (Remote)` : "Remote";
}

/** The postings feed has no posting date, so new jobs are the target titles not seen before. */
export class PinpointFetcher extends Employer<PinpointJob> {
  readonly ats = "pinpoint" as const;

  companyKeyFromUrl(url: URL): string {
    return this.companyKey(getPinpointSlug(url));
  }

  async formCompany(url: URL): Promise<Company> {
    const slug = getPinpointSlug(url);
    const page = pinpointListingUrl(slug);

    return {
      name: (await fetchPinpointCompanyName(slug)) ?? slug,
      ats: this.ats,
      identifier: slug,
      domain: new URL(page).origin,
      page,
      urls: [],
    };
  }

  protected getJobsFromResponse(data: unknown): PinpointJob[] {
    const parsed = PinpointResponseSchema.safeParse(data);

    if (!parsed.success) {
      logger.error({ issues: parsed.error.issues }, `${RED_CROSS} Invalid Pinpoint response`);
      return [];
    }

    return parsed.data.data;
  }

  protected getJobLink(job: PinpointJob, company: Company): string {
    return pinpointJobUrl(company.identifier, job.path);
  }

  protected normalizeJob(job: PinpointJob, company: Company): Job {
    return {
      company: formatCompanyName(company.name),
      role: job.title.trim(),
      link: this.getJobLink(job, company),
      location: formatLocation(job),
    };
  }

  async fetch(
    company: Company,
    knownKeys: ReadonlySet<string>,
    signal: AbortSignal
  ): Promise<Job[]> {
    try {
      const res = await fetch(company.page, { signal, headers: { accept: "application/json" } });

      if (!res.ok) {
        await logListingStatus("Pinpoint", company, res);
        return [];
      }

      return this.screen(
        this.getJobsFromResponse(await res.json()).map((job) => this.posting(job, company)),
        knownKeys
      ).map((posting) => posting.toJob());
    } catch (error) {
      if (await logListingFailure("Pinpoint", company, error)) return [];

      logger.error(
        {
          err: isAbortError(error) ? error.name : error,
          company: company.name,
          url: company.page,
        },
        `${RED_CROSS} Error fetching Pinpoint jobs`
      );

      return [];
    }
  }
}

export const pinpointFetcher = new PinpointFetcher();
