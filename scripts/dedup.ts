import path from "node:path";
import { fileURLToPath } from "node:url";

import { GREEN_CHECKMARK, RED_CROSS } from "@/constants/log";

import { deduplicateOpportunities, syncExpiredFlags } from "@/modules/postings/dedup";
import { loadOpportunities, loadUrls, saveOpportunities, saveUrls } from "@/utils/data";
import { deduplicate, groupUrlsByKey } from "@/utils/job-key";
import { logger } from "@/utils/logger";

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
