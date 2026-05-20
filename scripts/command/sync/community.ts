import { SOURCES } from "@/constants";

import type { Job } from "@/types";

import { createSyncContext, processJobs } from "./shared";

import fetchSource from "@/modules/github-parser";
import { logger } from "@/utils/logger";

export default async function syncCommunity() {
  logger.info("🔍 Syncing community...");

  const context = await createSyncContext();

  const jobs: Job[] = [];

  for (const source of SOURCES.filter((source) => !source.disabled)) {
    logger.info({ url: source.url }, `🔍 Fetching community: ${source.name}`);
    const fetched = await fetchSource(source);
    jobs.push(...fetched);
  }

  await processJobs({
    jobs,
    ...context,
  });
}
