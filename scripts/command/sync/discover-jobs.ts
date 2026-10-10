import { fetchEmployerJobs } from "@/modules/employer/discover";
import { asEmployer } from "@/modules/employer/registry";
import { loadCompanies } from "@/utils/data";
import { renderProgress, startProgress } from "@/utils/dev";
import { logger } from "@/utils/logger";

const CONCURRENCY = 10;
const SLOW_THRESHOLD_MS = 10_000;

export default async function discoverJobs() {
  const companies = (await loadCompanies()).map((company) => asEmployer(company));
  const total = companies.length;
  let completed = 0;

  const startedAt = Date.now();

  startProgress(total);

  const { jobs, slow, failed } = await fetchEmployerJobs(companies, {
    concurrency: CONCURRENCY,
    slowThresholdMs: SLOW_THRESHOLD_MS,
    onSettled() {
      completed++;
      renderProgress(completed, total);
    },
  });

  if (process.stdout.isTTY) {
    process.stdout.write("\n");
  }

  logger.info(
    {
      companies: total,
      jobs: jobs.length,
      duration: `${((Date.now() - startedAt) / 1000).toFixed(2)}s`,
      slow: slow.length,
      failed: failed.length,
    },
    "🔍 Discover jobs finished"
  );

  if (slow.length > 0) {
    logger.warn(
      {
        companies: slow.sort((a, b) => b.duration - a.duration).slice(0, 20),
      },
      "🐢 Slow companies"
    );
  }

  if (failed.length > 0) {
    logger.error(
      {
        companies: failed.map((company) => ({
          company: company.company,
          ats: company.ats,
          duration: `${company.duration}ms`,
          error: company.error instanceof Error ? company.error.message : String(company.error),
        })),
      },
      "❌ Failed companies"
    );
  }

  return jobs;
}
