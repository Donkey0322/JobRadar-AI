import pLimit from "p-limit";
import z from "zod";

import { RED_CROSS } from "@/constants/log";

import type { Company, Job } from "@/types";

import { Employer } from "../employer";

import {
  bambooHRJobUrl,
  bambooHRListingUrl,
  fetchBambooHRCompanyName,
  fetchBambooHRDatePosted,
  getBambooHRSlug,
  isBambooHRTenantResponse,
} from "@/modules/ats/bamboohr";
import { logListingFailure, logListingStatus } from "@/modules/employer/failure";
import { errorLog } from "@/store";
import { formatCompanyName } from "@/utils/company-name";
import { isAbortError } from "@/utils/http";
import { logger } from "@/utils/logger";

const LocationSchema = z
  .object({
    city: z.string().nullish(),
    state: z.string().nullish(),
    province: z.string().nullish(),
    country: z.string().nullish(),
  })
  .nullish();

export const BambooHRJobSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  jobOpeningName: z.string(),
  location: LocationSchema,
  atsLocation: LocationSchema,
  isRemote: z.unknown().optional(),
});

export const BambooHRResponseSchema = z.object({
  result: z.array(BambooHRJobSchema),
});

export type BambooHRJob = z.output<typeof BambooHRJobSchema> & { datePosted?: string };

const DATE_POSTED_CONCURRENCY = 8;

function formatLocation(job: BambooHRJob): string {
  const place = [job.location, job.atsLocation]
    .map((location) =>
      [location?.city, location?.state ?? location?.province, location?.country]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join(", ")
    )
    .find(Boolean);

  if (job.isRemote === true) return place ? `${place} (Remote)` : "Remote";
  return place ?? "";
}

export class BambooHRFetcher extends Employer<BambooHRJob> {
  readonly ats = "bamboohr" as const;

  companyKeyFromUrl(url: URL): string {
    return this.keyOf(getBambooHRSlug(url));
  }

  async formCompany(url: URL): Promise<Company> {
    const slug = getBambooHRSlug(url);
    const page = bambooHRListingUrl(slug);

    return {
      name: (await fetchBambooHRCompanyName(slug)) ?? slug,
      ats: this.ats,
      identifier: slug,
      domain: new URL(page).origin,
      page,
      urls: [],
    };
  }

  protected getJobsFromResponse(data: unknown): BambooHRJob[] {
    const parsed = BambooHRResponseSchema.safeParse(data);

    if (!parsed.success) {
      logger.error({ issues: parsed.error.issues }, `${RED_CROSS} Invalid BambooHR response`);
      return [];
    }

    return parsed.data.result;
  }

  protected getJobLink(job: BambooHRJob, company: Company): string {
    return bambooHRJobUrl(company.identifier, job.id);
  }

  protected normalizeJob(job: BambooHRJob, company: Company): Job {
    return {
      company: formatCompanyName(company.name),
      role: job.jobOpeningName.trim(),
      link: this.getJobLink(job, company),
      location: formatLocation(job),
    };
  }

  protected async collectListingJobs(
    company: Company,
    signal: AbortSignal
  ): Promise<BambooHRJob[] | null> {
    const res = await fetch(company.page, { signal, headers: { accept: "application/json" } });
    if (!res.ok || !isBambooHRTenantResponse(res)) return null;
    return this.getJobsFromResponse(await res.json());
  }

  async fetch(
    company: Company,
    knownKeys: ReadonlySet<string>,
    signal: AbortSignal
  ): Promise<Job[]> {
    try {
      const res = await fetch(company.page, { signal, headers: { accept: "application/json" } });

      if (!res.ok) {
        await logListingStatus("BambooHR", company, res);
        return [];
      }

      if (!isBambooHRTenantResponse(res)) {
        await errorLog.append(`BambooHR: ${company.name} - board no longer exists`);
        return [];
      }

      const rawJobs = this.getJobsFromResponse(await res.json());
      const jobs = await this.attachDatePosted(rawJobs, company, knownKeys, signal);

      return this.screen(
        jobs.map((job) => this.posting(job, company, job.datePosted)),
        knownKeys,
        { recent: true }
      ).map((posting) => posting.toJob());
    } catch (error) {
      if (await logListingFailure("BambooHR", company, error)) return [];

      logger.error(
        {
          err: isAbortError(error) ? error.name : error,
          company: company.name,
          url: company.page,
        },
        `${RED_CROSS} Error fetching BambooHR jobs`
      );

      return [];
    }
  }

  /**
   * The list endpoint has no posting date. Read it from the detail endpoint
   * only for titles that can still become a discovery.
   */
  private async attachDatePosted(
    jobs: BambooHRJob[],
    company: Company,
    knownKeys: ReadonlySet<string>,
    signal: AbortSignal
  ): Promise<BambooHRJob[]> {
    const pending = jobs.filter((job) => {
      const posting = this.posting(job, company);
      return posting.isTarget() && !posting.isKnown(knownKeys);
    });

    if (pending.length === 0) return jobs;

    const dates = new Map<string, string>();
    const limit = pLimit(DATE_POSTED_CONCURRENCY);

    await Promise.all(
      pending.map((job) =>
        limit(async () => {
          const date = await fetchBambooHRDatePosted(company.identifier, job.id, signal);
          if (date) dates.set(job.id, date);
        })
      )
    );

    if (dates.size < pending.length) {
      await errorLog.append(
        `BambooHR: ${company.name} - no posting date for ${pending.length - dates.size}/${pending.length} jobs`
      );
    }

    return jobs.map((job) => {
      const datePosted = dates.get(job.id);
      return datePosted ? { ...job, datePosted } : job;
    });
  }
}

export const bambooHRFetcher = new BambooHRFetcher();
