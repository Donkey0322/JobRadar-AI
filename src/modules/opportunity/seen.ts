import type { Job, Opportunity } from "@/types";

import { getJobKey } from "@/utils/job-key";

export type OpportunityLedger = {
  existing: Opportunity[];
  appended: Opportunity[];
  indexByKey: Map<string, number>;
  mutated: boolean;
};

/**
 * `refresh` bumps `postedAt` on every sighting. A sync run uses that so an
 * in-place reopen is visible. `preserve` keeps the stored `postedAt` when the
 * row already exists. Batch analysis uses that.
 */
export type SeenPostedAt = "refresh" | "preserve";

export function createOpportunityLedger(existing: Opportunity[]): OpportunityLedger {
  const indexByKey = new Map<string, number>();

  for (let index = 0; index < existing.length; index++) {
    const key = getJobKey(existing[index]!.link);

    if (!indexByKey.has(key)) {
      indexByKey.set(key, index);
    }
  }

  return {
    existing,
    appended: [],
    indexByKey,
    mutated: false,
  };
}

export function recordSeenOpportunity(
  ledger: OpportunityLedger,
  job: Job,
  postedAt: SeenPostedAt
): void {
  const key = getJobKey(job.link);
  const existingIndex = ledger.indexByKey.get(key);
  const nextOpportunity: Opportunity = {
    ...job,
    postedAt: resolvePostedAt(ledger, existingIndex, postedAt),
    expired: false,
  };

  if (existingIndex !== undefined) {
    ledger.existing[existingIndex] = nextOpportunity;
    ledger.mutated = true;
    return;
  }

  ledger.indexByKey.set(key, ledger.existing.length + ledger.appended.length);
  ledger.appended.push(nextOpportunity);
}

export function seenOpportunitiesToWrite(ledger: OpportunityLedger): {
  opportunities: Opportunity[];
  overwrite: boolean;
} | null {
  if (ledger.mutated) {
    const seenKeys = new Set<string>();
    const merged = [...ledger.existing, ...ledger.appended].filter((opportunity) => {
      const key = getJobKey(opportunity.link);

      if (seenKeys.has(key)) {
        return false;
      }

      seenKeys.add(key);
      return true;
    });

    return { opportunities: merged, overwrite: true };
  }

  if (ledger.appended.length > 0) {
    return { opportunities: ledger.appended, overwrite: false };
  }

  return null;
}

function resolvePostedAt(
  ledger: OpportunityLedger,
  existingIndex: number | undefined,
  postedAt: SeenPostedAt
): string {
  if (postedAt === "preserve" && existingIndex !== undefined) {
    return ledger.existing[existingIndex]!.postedAt;
  }

  return new Date().toISOString();
}
