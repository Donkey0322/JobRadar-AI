import { RED_CROSS } from "@/constants/log";

import type { ATS } from "@/modules/ats/types";
import type { Company, Job } from "@/types";

import { getJobKey, isKnownJob, toJobKeySet } from "@/modules/ats/job-key";
import { logListingFailure } from "@/modules/employer/failure";
import { Posting, type PostingDate } from "@/modules/posting/posting";
import { isAbortError } from "@/utils/http";
import { logger } from "@/utils/logger";

export type CompanyResult = Company | null;
export type MaybePromise<T> = T | Promise<T>;

const FETCH_TIMEOUT = 20_000;
const LEVER_TIMEOUT = 60_000;

export function identityKey(
  company: Pick<Company, "ats" | "identifier" | "domain" | "page">
): string {
  if (company.identifier) {
    return `${company.ats}:${company.identifier}`;
  }

  return `${company.ats}:${company.domain}:${company.page}`;
}

/**
 * One employer on a job board.
 *
 * The subclass is the board (Greenhouse, Lever, …). A row from `company.json`
 * is constructed with that subclass so `getJobs()` uses the matching fetch.
 * URL-only helpers (`companyKeyFromUrl`, `formCompany`) stay on the
 * shared instance because no employer exists yet.
 */
export abstract class Employer<TJob = unknown> {
  abstract readonly ats: ATS;

  #data?: Company;

  constructor(data?: Company) {
    if (!data) {
      return;
    }

    this.#data = {
      name: data.name,
      ats: data.ats,
      identifier: data.identifier,
      domain: data.domain,
      page: data.page,
      urls: data.urls ?? [],
    };
  }

  get name() {
    return this.#data?.name ?? "";
  }

  get identifier() {
    return this.#data?.identifier ?? "";
  }

  get domain() {
    return this.#data?.domain ?? "";
  }

  get page() {
    return this.#data?.page ?? "";
  }

  get urls() {
    return this.#data?.urls ?? [];
  }

  key(): string {
    return identityKey(this);
  }

  async getJobs(): Promise<Job[]> {
    const knownKeys = toJobKeySet(this.urls ?? []);
    const timeout = this.ats === "lever" ? LEVER_TIMEOUT : FETCH_TIMEOUT;
    const signal = AbortSignal.timeout(timeout);
    return this.fetch(this, knownKeys, signal);
  }

  /** Job keys currently on this company's board, unfiltered. */
  async listedKeys(signal: AbortSignal): Promise<Set<string> | null> {
    return this.listJobKeys(this, signal);
  }

  abstract companyKeyFromUrl(url: URL): string;

  abstract formCompany(url: URL): MaybePromise<CompanyResult>;

  /** Fix a stored row whose `page` is no longer a listing this board can read. */
  repairCompany(company: Company): Company {
    return company;
  }

  protected abstract getJobsFromResponse(data: unknown): TJob[];

  protected abstract getJobLink(job: TJob, company: Company): string;

  protected abstract normalizeJob(job: TJob, company: Company): Job;

  protected posting(
    job: TJob,
    company: Company,
    dates?: PostingDate | readonly PostingDate[]
  ): Posting {
    return Posting.from(this.normalizeJob(job, company), dates);
  }

  protected isKnownJob(link: string, knownKeys: ReadonlySet<string>) {
    return isKnownJob(link, knownKeys);
  }

  /**
   * Discover filter. Order is target, then known key, then recency when requested.
   * Each `fetch()` applies this to the link it returns. `getJobs()` does not filter again.
   */
  protected screen(
    postings: readonly Posting[],
    knownKeys: ReadonlySet<string>,
    options: { recent?: boolean } = {}
  ): Posting[] {
    return postings.filter(
      (posting) =>
        posting.isTarget() && !posting.isKnown(knownKeys) && (!options.recent || posting.isRecent())
    );
  }

  /** Listing failure, abort, and any other exception all return no jobs. */
  protected async failSoft(label: string, company: Company, error: unknown): Promise<Job[]> {
    if (await logListingFailure(label, company, error)) return [];

    if (isAbortError(error)) {
      logger.warn(
        {
          company: company.name,
          url: company.page,
        },
        `⚠️ ${label} request aborted`
      );
      return [];
    }

    logger.error(
      {
        error,
        company: company.name,
        url: company.page,
      },
      `${RED_CROSS} Error fetching ${label.toLowerCase()} jobs`
    );
    return [];
  }

  /** Build `${ats}:${identifier}` keys used by company list grouping. */
  protected companyKey(identifier: string): string {
    return `${this.ats}:${identifier}`;
  }

  abstract fetch(
    company: Company,
    knownKeys: ReadonlySet<string>,
    signal: AbortSignal
  ): Promise<Job[]>;

  /**
   * Job keys currently advertised on `company.page`, unfiltered.
   * Returns null when the listing cannot be retrieved.
   */
  async listJobKeys(company: Company, signal: AbortSignal): Promise<Set<string> | null> {
    if (!company.page) {
      return null;
    }

    try {
      const jobs = await this.collectListingJobs(company, signal);
      if (jobs === null) {
        return null;
      }

      const keys = new Set<string>();
      for (const job of jobs) {
        const link = this.getJobLink(job, company);
        if (link) {
          keys.add(getJobKey(link));
        }
      }
      return keys;
    } catch {
      return null;
    }
  }

  /**
   * Raw listing jobs with no discover filters (target role, recency, knownKeys).
   * Default: GET `company.page` as JSON. Override for POST / paginated ATS.
   */
  protected async collectListingJobs(
    company: Company,
    signal: AbortSignal
  ): Promise<TJob[] | null> {
    const res = await fetch(company.page, { signal });
    if (!res.ok) {
      return null;
    }

    try {
      return this.getJobsFromResponse(await res.json());
    } catch {
      return null;
    }
  }
}
