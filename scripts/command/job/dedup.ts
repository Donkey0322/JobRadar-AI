import { GREEN_CHECKMARK } from "@/constants/log";

import { recordStage } from "../../github/summary";

import { deduplicate, groupUrlsByKey } from "@/modules/ats/job-key";
import { deduplicateOpportunities, syncExpiredFlags } from "@/modules/opportunity/dedup";
import * as store from "@/store";
import { logger } from "@/utils/logger";

export async function dedupeStored() {
  const urls = await store.urls.load();
  const dedupedUrls = deduplicate(urls);

  const opportunities = await store.opportunities.load();
  const dedupedOpportunities = syncExpiredFlags(
    deduplicateOpportunities(opportunities),
    groupUrlsByKey(dedupedUrls)
  );

  await Promise.all([
    store.urls.save(new Set(dedupedUrls)),
    store.opportunities.replace(dedupedOpportunities),
  ]);

  const urlsRemoved = urls.size - dedupedUrls.length;
  const opportunitiesRemoved = opportunities.length - dedupedOpportunities.length;

  logger.info(
    {
      urls: {
        original: urls.size,
        unique: dedupedUrls.length,
        removed: urlsRemoved,
      },
      opportunities: {
        original: opportunities.length,
        unique: dedupedOpportunities.length,
        removed: opportunitiesRemoved,
      },
    },
    `${GREEN_CHECKMARK} Successfully deduped urls and opportunities`
  );

  return { urlsRemoved, opportunitiesRemoved };
}

export default async function main() {
  try {
    const removed = await dedupeStored();
    recordStage({
      stage: "maintenance",
      task: "dedup",
      status: "success",
      urlsRemoved: removed.urlsRemoved,
      opportunitiesRemoved: removed.opportunitiesRemoved,
      saved: "complete",
    });
  } catch (error) {
    recordStage({
      stage: "maintenance",
      task: "dedup",
      status: "failed",
      reason: "dedup failed",
      saved: "unknown",
    });
    throw error;
  }
}
