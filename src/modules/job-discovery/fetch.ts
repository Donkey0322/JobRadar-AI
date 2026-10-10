import pLimit from "p-limit";

import { asEmployer } from "@/modules/ats/core/registry";
import { loadCompanies } from "@/utils/data";
import { renderProgress, startProgress } from "@/utils/dev";
import { deduplicateJobs } from "@/utils/job-key";
import { logger } from "@/utils/logger";

const limit = pLimit(10);

const SLOW_THRESHOLD = 10_000;

export default async function discoverJobs() {
  const companies = (await loadCompanies()).map((company) => asEmployer(company));

  const total = companies.length;

  let completed = 0;

  const slowCompanies: {
    company: string;
    ats: string;
    duration: number;
  }[] = [];

  const failedCompanies: {
    company: string;
    ats: string;
    duration: number;
    error: unknown;
  }[] = [];

  const startTime = Date.now();

  startProgress(total);

  const results = await Promise.all(
    companies.map((company) =>
      limit(async () => {
        const start = Date.now();

        try {
          const jobs = await company.getJobs();

          const duration = Date.now() - start;

          if (duration >= SLOW_THRESHOLD) {
            slowCompanies.push({
              company: company.name,
              ats: company.ats,
              duration,
            });
          }

          completed++;

          renderProgress(completed, total);

          return jobs;
        } catch (error) {
          const duration = Date.now() - start;

          failedCompanies.push({
            company: company.name,
            ats: company.ats,
            duration,
            error,
          });

          completed++;

          renderProgress(completed, total);

          return [];
        }
      })
    )
  );

  const newJobs = deduplicateJobs(results.flat());

  const endTime = Date.now();

  if (process.stdout.isTTY) {
    process.stdout.write("\n");
  }

  logger.info(
    {
      companies: total,
      jobs: newJobs.length,
      duration: `${((endTime - startTime) / 1000).toFixed(2)}s`,
      slow: slowCompanies.length,
      failed: failedCompanies.length,
    },
    "🔍 Discover jobs finished"
  );

  if (slowCompanies.length > 0) {
    logger.warn(
      {
        companies: slowCompanies.sort((a, b) => b.duration - a.duration).slice(0, 20),
      },
      "🐢 Slow companies"
    );
  }

  if (failedCompanies.length > 0) {
    logger.error(
      {
        companies: failedCompanies.map((c) => ({
          company: c.company,
          ats: c.ats,
          duration: `${c.duration}ms`,
          error: c.error instanceof Error ? c.error.message : String(c.error),
        })),
      },
      "❌ Failed companies"
    );
  }

  return newJobs;
}
