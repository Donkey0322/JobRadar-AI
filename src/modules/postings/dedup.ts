import type { Opportunity } from "@/types";

import { getJobKey } from "@/utils/job-key";

/** Drop expired rows last seen longer ago than this. `postedAt` is that sighting, not the expiry time. */
export const STALE_EXPIRED_OPPORTUNITY_MS = 90 * 24 * 60 * 60 * 1000;

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

/**
 * Keep every active row. Drop expired rows whose `postedAt` is older than the window.
 * A row with an unreadable `postedAt` stays, so a bad date cannot delete it.
 */
export function dropStaleExpiredOpportunities(
  opportunities: readonly Opportunity[],
  now = Date.now(),
  maxAgeMs = STALE_EXPIRED_OPPORTUNITY_MS
): Opportunity[] {
  const cutoff = now - maxAgeMs;

  return opportunities.filter((opportunity) => {
    if (!opportunity.expired) {
      return true;
    }

    const postedAt = new Date(opportunity.postedAt).getTime();
    if (Number.isNaN(postedAt)) {
      return true;
    }

    return postedAt >= cutoff;
  });
}
