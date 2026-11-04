import path from "node:path";
import { fileURLToPath } from "node:url";

import { GREEN_CHECKMARK, RED_CROSS } from "@/constants/log";

import { deduplicate, groupUrlsByKey } from "@/modules/ats/job-key";
import { deduplicateOpportunities, syncExpiredFlags } from "@/modules/opportunity/dedup";
import * as store from "@/store";
import { logger } from "@/utils/logger";

export default async function main() {
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
