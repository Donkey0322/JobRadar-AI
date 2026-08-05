import { GREEN_CHECKMARK, RED_CROSS } from "@/constants/log";

import type { Opportunity } from "@/types";

import { deduplicate, getJobKey } from "@/modules/job-dedup";
import { loadOpportunities, loadUrls, saveOpportunities, saveUrls } from "@/utils/data";
import { logger } from "@/utils/logger";

function deduplicateOpportunities(opportunities: Opportunity[]): Opportunity[] {
  const unique = new Map<string, Opportunity>();

  for (const opportunity of opportunities) {
    const key = getJobKey(opportunity.link);

    if (!unique.has(key)) {
      unique.set(key, opportunity);
    }
  }

  return [...unique.values()];
}

async function main() {
  const urls = await loadUrls();
  const dedupedUrls = deduplicate(urls);

  const opportunities = await loadOpportunities();
  const dedupedOpportunities = deduplicateOpportunities(opportunities);

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

main().catch((err) => {
  logger.fatal({ err }, `${RED_CROSS} Fatal error`);
  process.exit(1);
});
