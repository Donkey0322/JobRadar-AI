import path from "node:path";
import { fileURLToPath } from "node:url";

import { GREEN_CHECKMARK, RED_CROSS } from "@/constants/log";

import type { Opportunity } from "@/types";

import { loadOpportunities, loadUrls, saveOpportunities, saveUrls } from "@/utils/data";
import { deduplicate, getJobKey, groupUrlsByKey } from "@/utils/job-key";
import { logger } from "@/utils/logger";

function shouldReplace(existing: Opportunity, candidate: Opportunity): boolean {
  if (existing.expired !== candidate.expired) {
    return existing.expired;
  }

  return new Date(candidate.postedAt).getTime() > new Date(existing.postedAt).getTime();
}

export function deduplicateOpportunities(opportunities: Opportunity[]): Opportunity[] {
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

function resolveLiveUrl(
  currentLink: string,
  liveUrls: readonly string[] | undefined
): string | undefined {
  if (!liveUrls || liveUrls.length === 0) {
    return undefined;
  }

  if (liveUrls.includes(currentLink)) {
    return currentLink;
  }

  return liveUrls[0];
}

/**
 * Liveness is keyed by job identity, not the exact opportunity URL.
 * If the stored link died but a sibling URL for the same key is still live,
 * keep the row active and point Apply at the live URL.
 */
export function syncExpiredFlags(
  opportunities: Opportunity[],
  liveUrlsByKey: ReadonlyMap<string, readonly string[]>
): Opportunity[] {
  return opportunities.map((opportunity) => {
    const liveUrl = resolveLiveUrl(
      opportunity.link,
      liveUrlsByKey.get(getJobKey(opportunity.link))
    );
    const expired = liveUrl === undefined;
    const link = liveUrl ?? opportunity.link;

    if (opportunity.expired === expired && opportunity.link === link) {
      return opportunity;
    }

    return {
      ...opportunity,
      expired,
      link,
    };
  });
}

export default async function main() {
  const urls = await loadUrls();
  const dedupedUrls = deduplicate(urls);

  const opportunities = await loadOpportunities();
  const dedupedOpportunities = syncExpiredFlags(
    deduplicateOpportunities(opportunities),
    groupUrlsByKey(dedupedUrls)
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
