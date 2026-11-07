import pLimit from "p-limit";

import type { Job } from "@/types";

import { recordStage } from "../github/summary";
import { createSyncContext, processJobs } from "../ingest";

import { isKnownJob } from "@/modules/ats/job-key";
import { companyKey } from "@/modules/employer/build";
import { knownEmployerName } from "@/modules/employer/remap";
import { Posting } from "@/modules/posting";
import { canonicalizeApplyLink } from "@/modules/posting/apply-link";
import fetchSource, { SOURCES } from "@/modules/source";
import * as store from "@/store";
import { logger } from "@/utils/logger";

const RESOLVE_CONCURRENCY = 10;

export default async function syncCommunity() {
  logger.info("🔍 Syncing community...");
  const started = Date.now();
  let sources: number | undefined;
  let fetchedCount: number | undefined;
  let matchedCount: number | undefined;

  try {
    const context = await createSyncContext();
    sources = 0;
    fetchedCount = 0;
    matchedCount = 0;
    const companiesByKey = new Map(
      (await store.companies.load()).map((company) => [companyKey(company), company])
    );
    const limit = pLimit(RESOLVE_CONCURRENCY);

    const jobs: Job[] = [];

    for (const source of SOURCES.filter((source) => !source.disabled)) {
      logger.info({ url: source.url }, `🔍 Fetching community: ${source.name}`);
      const fetched = await fetchSource(source);
      sources += 1;
      fetchedCount += fetched.length;
      const candidates = fetched
        .map((job) => Posting.from(job))
        .filter((posting) => posting.isTarget() && !posting.isKnown(context.keys));

      const matched = (
        await Promise.all(
          candidates.map((posting) =>
            limit(async () => {
              const link = await canonicalizeApplyLink(posting.link);
              if (link !== posting.link && isKnownJob(link, context.keys)) {
                return null;
              }

              const company =
                link === posting.link
                  ? posting.company
                  : (knownEmployerName(link, companiesByKey) ?? posting.company);

              return { ...posting.toJob(), link, company };
            })
          )
        )
      ).filter((job): job is Job => job !== null);

      logger.info(
        { fetched: fetched.length, matched: matched.length },
        `📋 Filtered community: ${source.name}`
      );

      matchedCount += matched.length;
      jobs.push(...matched);
    }

    const processed = await processJobs({
      jobs,
      ...context,
    });

    recordStage({
      stage: "jobs",
      mode: "sync",
      status: processed.failed > 0 || processed.forceStopped ? "partial" : "success",
      sources,
      fetched: fetchedCount,
      matched: matchedCount,
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
      mode: "sync",
      status: "failed",
      reason: "sync failed",
      saved: "unknown",
      durationMs: Date.now() - started,
      ...(sources !== undefined && fetchedCount !== undefined && matchedCount !== undefined
        ? { sources, fetched: fetchedCount, matched: matchedCount }
        : {}),
    });
    throw error;
  }
}
