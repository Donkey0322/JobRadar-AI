import pLimit from "p-limit";
import z from "zod";

import { RED_CROSS } from "@/constants/log";

import type { Company, Job } from "@/types";

import { Employer } from "../employer";

import { logListingFailure } from "@/modules/employer/shared/fetch-log";
import {
  fetchRipplingBoardTitle,
  fetchRipplingCreatedOn,
  getRipplingSlug,
  ripplingJobUrl,
  ripplingListingUrl,
} from "@/modules/employer/shared/rippling";
import { appendErrorLog } from "@/utils/data";
import { isAbortError } from "@/utils/http";
import { logger } from "@/utils/logger";
import { formatCompanyName } from "@/utils/string";

export const RipplingJobSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  url: z.string().optional(),
  workLocation: z.object({ label: z.string() }).nullish(),
});

export const RipplingResponseSchema = z.array(RipplingJobSchema);

export type RipplingJob = z.infer<typeof RipplingJobSchema> & {
  location: string;
  createdOn?: string;
};

const CREATED_ON_CONCURRENCY = 8;

/** The listing repeats a posting once per work location. */
function mergeLocations(rows: z.infer<typeof RipplingResponseSchema>): RipplingJob[] {
  const jobs = new Map<string, RipplingJob & { locations: Set<string> }>();

  for (const row of rows) {
    const id = row.uuid.toLowerCase();
    const label = row.workLocation?.label.trim();
    const job = jobs.get(id) ?? { ...row, uuid: id, location: "", locations: new Set<string>() };

    if (label) job.locations.add(label);
    jobs.set(id, job);
  }

  return [...jobs.values()].map(({ locations, ...job }) => ({
    ...job,
    location: [...locations].join("; "),
  }));
}

export class RipplingFetcher extends Employer<RipplingJob> {
  readonly ats = "rippling" as const;

  companyKeyFromUrl(url: URL): string {
    return this.companyKey(getRipplingSlug(url) ?? url.hostname);
  }

  async formCompany(url: URL): Promise<Company | null> {
    const slug = getRipplingSlug(url);
    if (!slug) return null;

    return {
      name: (await fetchRipplingBoardTitle(slug)) ?? slug,
      ats: this.ats,
      identifier: slug,
      domain: url.origin,
      page: ripplingListingUrl(slug),
      urls: [],
    };
  }

  protected getJobsFromResponse(data: unknown): RipplingJob[] {
    const parsed = RipplingResponseSchema.safeParse(data);

    if (!parsed.success) {
      logger.error({ issues: parsed.error.issues }, `${RED_CROSS} Invalid Rippling response`);
      return [];
    }

    return mergeLocations(parsed.data);
  }

  protected getJobLink(job: RipplingJob, company: Company): string {
    return ripplingJobUrl(company.identifier, job.uuid);
  }

  protected normalizeJob(job: RipplingJob, company: Company): Job {
    return {
      company: formatCompanyName(company.name),
      role: job.name.trim(),
      link: this.getJobLink(job, company),
      location: job.location,
    };
  }

  async fetch(
    company: Company,
    knownKeys: ReadonlySet<string>,
    signal: AbortSignal
  ): Promise<Job[]> {
    try {
      const res = await fetch(company.page, { signal });

      if (!res.ok) {
        await appendErrorLog(`Rippling: ${company.name} - ${res.status} - ${res.statusText}`);
        return [];
      }

      const rawJobs = this.getJobsFromResponse(await res.json());
      const jobs = await this.attachCreatedOn(rawJobs, company, knownKeys, signal);

      return jobs
        .map((job) => this.posting(job, company, job.createdOn))
        .filter(
          (posting) => posting.isTarget() && !posting.isKnown(knownKeys) && posting.isRecent()
        )
        .map((posting) => posting.toJob());
    } catch (error) {
      if (await logListingFailure("Rippling", company, error)) return [];

      logger.error(
        {
          err: isAbortError(error) ? error.name : error,
          company: company.name,
          url: company.page,
        },
        `${RED_CROSS} Error fetching Rippling jobs`
      );

      return [];
    }
  }

  /**
   * The listing API has no posting date. Read it from the job page only for
   * titles that can still become a discovery.
   */
  private async attachCreatedOn(
    jobs: RipplingJob[],
    company: Company,
    knownKeys: ReadonlySet<string>,
    signal: AbortSignal
  ): Promise<RipplingJob[]> {
    const pending = jobs.filter((job) => {
      const posting = this.posting(job, company);
      return posting.isTarget() && !posting.isKnown(knownKeys);
    });

    if (pending.length === 0) return jobs;

    const dates = new Map<string, string>();
    const limit = pLimit(CREATED_ON_CONCURRENCY);

    await Promise.all(
      pending.map((job) =>
        limit(async () => {
          const date = await fetchRipplingCreatedOn(this.getJobLink(job, company), signal);
          if (date) dates.set(job.uuid, date);
        })
      )
    );

    if (dates.size < pending.length) {
      await appendErrorLog(
        `Rippling: ${company.name} - no posting date for ${pending.length - dates.size}/${pending.length} jobs`
      );
    }

    return jobs.map((job) => {
      const createdOn = dates.get(job.uuid);
      return createdOn ? { ...job, createdOn } : job;
    });
  }
}

export const ripplingFetcher = new RipplingFetcher();
