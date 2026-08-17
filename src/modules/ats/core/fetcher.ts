import type { ATS } from "../type";
import type { Company, Job } from "@/types";

import { isKnownJob } from "@/utils/job-key";

export type CompanyResult = Company | null;
export type MaybePromise<T> = T | Promise<T>;

export interface ATSAdapter {
  readonly ats: ATS;

  /**
   * Sync grouping key for URLs that resolve to the same company.
   * Must not perform network I/O. Prefer `${ats}:${identifier}` when known.
   */
  companyKeyFromUrl(url: URL): string;

  formCompany(url: URL): MaybePromise<CompanyResult>;

  fetch(company: Company, knownKeys: ReadonlySet<string>, signal: AbortSignal): Promise<Job[]>;
}

/**
 * Common contract implemented by every ATS adapter.
 *
 * Instances are stateless singletons. Fetch orchestration and response
 * handling remain adapter-specific because APIs differ in pagination,
 * authentication, response format, and stopping rules.
 */
export abstract class ATSFetcher<TJob> {
  abstract readonly ats: ATS;

  abstract companyKeyFromUrl(url: URL): string;

  abstract formCompany(url: URL): MaybePromise<CompanyResult>;

  protected abstract getJobsFromResponse(data: unknown): TJob[];

  protected abstract getJobLink(job: TJob, company: Company): string;

  protected abstract normalizeJob(job: TJob, company: Company): Job;

  protected isKnownJob(link: string, knownKeys: ReadonlySet<string>) {
    return isKnownJob(link, knownKeys);
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
}
