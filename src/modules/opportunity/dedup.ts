import type { Opportunity } from "@/types";

import { getJobKey } from "@/utils/job-key";

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
