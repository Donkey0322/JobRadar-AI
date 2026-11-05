import type { Company, Job } from "@/types";

import { Employer } from "../employer";

import { getHostnameWithoutWww } from "@/utils/url";

/** Career sites on an ATS JobRadar cannot read yet. Rows keep their URLs but list nothing. */
export class NoneFetcher extends Employer<Job> {
  readonly ats = "none" as const;

  companyKeyFromUrl(url: URL): string {
    return this.keyOf(getHostnameWithoutWww(url));
  }

  formCompany(url: URL): Company {
    const identifier = getHostnameWithoutWww(url);

    return {
      name: identifier,
      ats: this.ats,
      identifier,
      domain: url.origin,
      page: "",
      urls: [],
    };
  }

  protected getJobsFromResponse(): Job[] {
    return [];
  }

  protected getJobLink(job: Job): string {
    return job.link;
  }

  protected normalizeJob(job: Job): Job {
    return job;
  }

  async fetch(): Promise<Job[]> {
    return [];
  }
}

export const noneFetcher = new NoneFetcher();
