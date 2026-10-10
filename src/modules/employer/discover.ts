import pLimit from "p-limit";

import type { Employer } from "./employer";
import type { Job } from "@/types";

import { deduplicateJobs } from "@/utils/job-key";

export type DiscoverCompanyTiming = {
  company: string;
  ats: string;
  duration: number;
};

export type DiscoverCompanyFailure = DiscoverCompanyTiming & {
  error: unknown;
};

export async function fetchEmployerJobs(
  companies: readonly Employer[],
  options: {
    concurrency?: number;
    slowThresholdMs?: number;
    onSettled?: () => void;
  } = {}
): Promise<{
  jobs: Job[];
  slow: DiscoverCompanyTiming[];
  failed: DiscoverCompanyFailure[];
}> {
  const concurrency = options.concurrency ?? 10;
  const slowThresholdMs = options.slowThresholdMs ?? 10_000;
  const limit = pLimit(concurrency);
  const slow: DiscoverCompanyTiming[] = [];
  const failed: DiscoverCompanyFailure[] = [];

  const results = await Promise.all(
    companies.map((company) =>
      limit(async () => {
        const start = Date.now();

        try {
          const jobs = await company.getJobs();
          const duration = Date.now() - start;

          if (duration >= slowThresholdMs) {
            slow.push({
              company: company.name,
              ats: company.ats,
              duration,
            });
          }

          options.onSettled?.();
          return jobs;
        } catch (error) {
          failed.push({
            company: company.name,
            ats: company.ats,
            duration: Date.now() - start,
            error,
          });

          options.onSettled?.();
          return [];
        }
      })
    )
  );

  return {
    jobs: deduplicateJobs(results.flat()),
    slow,
    failed,
  };
}
