import type { Company } from "../../type";
import type { Job } from "@/types";

export abstract class JobFetcher<TJob> {
  abstract formCompany(url: URL): Promise<Company>;
  protected abstract getJobsFromResponse(data: unknown): TJob[];
  protected abstract normalizeJob(job: TJob, companyName: string): Job;
  abstract fetchJobs(company: Company, urls: Set<string>, signal: AbortSignal): Promise<Job[]>;
}
