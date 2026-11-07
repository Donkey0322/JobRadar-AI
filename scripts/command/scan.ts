import "dotenv/config";

import { recordStage } from "../github/summary";
import { createSyncContext, processJobs } from "../ingest";
import { renderProgress, startProgress } from "../utils/progress";

import { ALLOWED_COUNTRIES } from "@/config";
import { fetchEmployerJobs } from "@/modules/employer/discover";
import { asBoard } from "@/modules/employer/registry";
import { classifyLocations } from "@/modules/posting/analysis/location";
import * as store from "@/store";
import { logger } from "@/utils/logger";

const CONCURRENCY = 10;
const SLOW_THRESHOLD_MS = 10_000;

async function discoverJobs() {
  const companies = (await store.companies.load()).map((company) => asBoard(company));
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

  return {
    jobs,
    companies: total,
    listingFailed: failed.length,
    slow: slow.length,
  };
}

export default async function syncDiscover() {
  logger.info({ AI_MODE: process.env.AI_MODE }, "🔍 Discovering jobs...");
  const started = Date.now();
  let discovered: Awaited<ReturnType<typeof discoverJobs>> | undefined;

  try {
    const context = await createSyncContext();
    discovered = await discoverJobs();
    const jobs = discovered.jobs;
    const locations = await classifyLocations(jobs);

    for (let index = 0; index < jobs.length; index++) {
      const country = locations[index];

      if (country) {
        jobs[index]!.country = country;
      }
    }

    const processed = await processJobs({
      jobs,
      ...context,

      filter(job) {
        if (ALLOWED_COUNTRIES.size > 0 && job.country && !ALLOWED_COUNTRIES.has(job.country)) {
          logger.info(
            {
              company: job.company,
              role: job.role,
              url: job.link,
              location: job.location,
              country: job.country,
            },
            "⏭️ Skipped by location filter"
          );

          return true;
        }

        return false;
      },
    });

    recordStage({
      stage: "jobs",
      mode: "scan",
      status:
        processed.failed > 0 || processed.forceStopped || discovered.listingFailed > 0
          ? "partial"
          : "success",
      companies: discovered.companies,
      discovered: discovered.jobs.length,
      slow: discovered.slow,
      listingFailed: discovered.listingFailed,
      received: processed.received,
      jobsAdded: processed.count,
      opportunitiesAdded: processed.opportunitiesAdded,
      skipped: processed.skipped,
      ...(Object.keys(processed.skipReasons).length > 0
        ? { skipReasons: processed.skipReasons }
        : {}),
      failed: processed.failed,
      batched: processed.batched,
      notStarted: processed.notStarted,
      durationMs: Date.now() - started,
      saved: "complete",
    });
  } catch (error) {
    recordStage({
      stage: "jobs",
      mode: "scan",
      status: "failed",
      reason: "scan failed",
      saved: "unknown",
      durationMs: Date.now() - started,
      ...(discovered
        ? {
            companies: discovered.companies,
            discovered: discovered.jobs.length,
            slow: discovered.slow,
            listingFailed: discovered.listingFailed,
          }
        : {}),
    });
    throw error;
  }
}
