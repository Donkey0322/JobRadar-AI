import path from "node:path";
import { fileURLToPath } from "node:url";

import { GREEN_CHECKMARK, RED_CROSS } from "@/constants/log";

import type { Opportunity } from "@/types";

import { deduplicate, getJobKey, toJobKeySet } from "@/modules/job-dedup";
import { loadOpportunities, loadUrls, saveOpportunities, saveUrls } from "@/utils/data";
import { logger } from "@/utils/logger";

function shouldReplace(existing: Opportunity, candidate: Opportunity): boolean {
  if (existing.expired !== candidate.expired) {
    return existing.expired;
  }

  return new Date(candidate.postedAt).getTime() > new Date(existing.postedAt).getTime();
}

function deduplicateOpportunities(opportunities: Opportunity[]): Opportunity[] {
  const unique = new Map<string, Opportunity>();

  for (const opportunity of opportunities) {
    const key = getJobKey(opportunity.link);
    const previous = unique.get(key);

    if (!previous || shouldReplace(previous, opportunity)) {
      unique.set(key, opportunity);
    }
  }

  return [...unique.values()];
}

function syncExpiredFlags(
  opportunities: Opportunity[],
  activeKeys: ReadonlySet<string>
): Opportunity[] {
  return opportunities.map((opportunity) => {
    const expired = !activeKeys.has(getJobKey(opportunity.link));

    if (opportunity.expired === expired) {
      return opportunity;
    }

    return {
      ...opportunity,
      expired,
    };
  });
}

export default async function main() {
  const urls = await loadUrls();
  const dedupedUrls = deduplicate(urls);
  const activeKeys = toJobKeySet(dedupedUrls);

  const opportunities = await loadOpportunities();
  const dedupedOpportunities = syncExpiredFlags(
    deduplicateOpportunities(opportunities),
    activeKeys
  );

  await Promise.all([
    saveUrls(new Set(dedupedUrls)),
    saveOpportunities(dedupedOpportunities, true),
  ]);

  logger.info(
    {
      urls: {
        original: urls.size,
        unique: dedupedUrls.length,
        removed: urls.size - dedupedUrls.length,
      },
      opportunities: {
        original: opportunities.length,
        unique: dedupedOpportunities.length,
        removed: opportunities.length - dedupedOpportunities.length,
      },
    },
    `${GREEN_CHECKMARK} Successfully deduped urls and opportunities`
  );
}

const isDirectRun =
  process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((err) => {
    logger.fatal({ err }, `${RED_CROSS} Fatal error`);
    process.exit(1);
  });
}
