import { SOURCES } from "@/constants";

import type { Job } from "@/types";

import { createSyncContext, processJobs } from "./shared";

import { isTarget } from "@/modules/ats/core/filter";
import fetchSource from "@/modules/community-source";
import { isKnownJob } from "@/utils/job-key";
import { logger } from "@/utils/logger";

export default async function syncCommunity() {
  logger.info("🔍 Syncing community...");

  const context = await createSyncContext();

  const jobs: Job[] = [];

  for (const source of SOURCES.filter((source) => !source.disabled)) {
    logger.info({ url: source.url }, `🔍 Fetching community: ${source.name}`);
    const fetched = await fetchSource(source);
    const matched = fetched.filter(
      (job) => isTarget(job.role) && !isKnownJob(job.link, context.keys)
    );

    logger.info(
      { fetched: fetched.length, matched: matched.length },
      `📋 Filtered community: ${source.name}`
    );

    jobs.push(...matched);
  }

  await processJobs({
    jobs,
    ...context,
  });
}
