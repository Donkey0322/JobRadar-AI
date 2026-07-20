import type { ATS, Company } from "../type";
import type { Job } from "@/types";

export type CompanyResult = Company | null;
export type MaybePromise<T> = T | Promise<T>;

export interface ATSAdapter {
  readonly ats: ATS;

  formCompany(url: URL): MaybePromise<CompanyResult>;

  fetch(company: Company, urls: Set<string>, signal: AbortSignal): Promise<Job[]>;
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

  abstract formCompany(url: URL): MaybePromise<CompanyResult>;

  protected abstract getJobsFromResponse(data: unknown): TJob[];

  protected abstract getJobLink(job: TJob, company: Company): string;

  protected abstract normalizeJob(job: TJob, company: Company): Job;

  abstract fetch(company: Company, urls: Set<string>, signal: AbortSignal): Promise<Job[]>;
}
