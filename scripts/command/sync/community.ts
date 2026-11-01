import pLimit from "p-limit";

import { SOURCES } from "@/constants";

import type { Job } from "@/types";

import { createSyncContext, processJobs } from "./shared";

import { getCompanyKey } from "@/modules/employer/build";
import { knownEmployerName } from "@/modules/employer/remap";
import { Posting } from "@/modules/posting";
import { canonicalizeApplyLink } from "@/modules/posting/apply-link";
import fetchSource from "@/modules/source";
import { loadCompanies } from "@/utils/data";
import { isKnownJob } from "@/utils/job-key";
import { logger } from "@/utils/logger";

const RESOLVE_CONCURRENCY = 10;

export default async function syncCommunity() {
  logger.info("🔍 Syncing community...");

  const context = await createSyncContext();
  const companiesByKey = new Map(
    (await loadCompanies()).map((company) => [getCompanyKey(company), company])
  );
  const limit = pLimit(RESOLVE_CONCURRENCY);

  const jobs: Job[] = [];

  for (const source of SOURCES.filter((source) => !source.disabled)) {
    logger.info({ url: source.url }, `🔍 Fetching community: ${source.name}`);
    const fetched = await fetchSource(source);
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

    jobs.push(...matched);
  }

  await processJobs({
    jobs,
    ...context,
  });
}
