import { deduplicate } from "@/modules/job-dedup";
import { loadUrls } from "@/utils/data";
import { saveUrls } from "@/utils/data";
import { logger } from "@/utils/logger";

async function main() {
  const sent = await loadUrls();
  const deduped = deduplicate(Array.from(sent));
  await saveUrls(new Set(deduped));

  logger.info({ original: sent.size, unique: deduped.length }, "✅ Successfully deduped urls");
}

main().catch((err) => {
  logger.fatal({ err }, "❌ Fatal error");
  process.exit(1);
});
