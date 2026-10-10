import type { JDFetchResult } from "../detail/fetch";
import type { ATS } from "../type";
import type { Company, Job } from "@/types";

import { getJobKey, isKnownJob, toJobKeySet } from "@/utils/job-key";

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
 * URL-only helpers (`companyKeyFromUrl`, `formCompany`, `fetchJD`) stay on the
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
    const jobs = await this.fetch(this, knownKeys, signal);

    return jobs.filter((job) => !isKnownJob(job.link, knownKeys));
  }

  /** Job keys currently on this company's board, unfiltered. */
  async listedKeys(signal: AbortSignal): Promise<Set<string> | null> {
    return this.listJobKeys(this, signal);
  }

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

  /** Job description for one posting URL. */
  abstract fetchJD(url: string, signal: AbortSignal): Promise<JDFetchResult>;

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
