import type { Job, Opportunity } from "@/types";

import { ARCHIVE_PATH, OPPORTUNITIES_PATH, OPPORTUNITY_ARCHIVE_CHUNK } from "@/store/paths";
import {
  appendNdjsonPartitions,
  loadNdjsonPartitions,
  writeNdjsonPartitions,
} from "@/utils/ndjson-archive";

export async function loadOpportunities(): Promise<Opportunity[]> {
  try {
    return await loadNdjsonPartitions<Opportunity>(
      OPPORTUNITIES_PATH,
      ARCHIVE_PATH,
      "opportunities"
    );
  } catch {
    return [];
  }
}

/** Append opportunities. An empty list does not touch the file. */
export async function appendOpportunities(opportunities: Job[]) {
  if (opportunities.length === 0) return;

  await appendNdjsonPartitions(
    OPPORTUNITIES_PATH,
    ARCHIVE_PATH,
    "opportunities",
    opportunities,
    OPPORTUNITY_ARCHIVE_CHUNK
  );
}

/** Replace the opportunity file, including an empty list. */
export async function replaceOpportunities(opportunities: Job[]) {
  await writeNdjsonPartitions(
    OPPORTUNITIES_PATH,
    ARCHIVE_PATH,
    "opportunities",
    opportunities,
    OPPORTUNITY_ARCHIVE_CHUNK
  );
}

export const opportunities = {
  load: loadOpportunities,
  append: appendOpportunities,
  replace: replaceOpportunities,
};
