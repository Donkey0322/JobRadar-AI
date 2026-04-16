import "dotenv/config";

import processor from "@/main";
import crawler from "@/modules/company-tacker/fetch";
import { logger } from "@/utils/logger";

const args = new Set(process.argv.slice(2));
const isDev = args.has("--dev");

async function main() {
  logger.info("🔍 Crawling companies...");
  const jobs = await crawler();

  logger.info("🔍 Processing jobs...");
  await processor(jobs, false, isDev);
}

main().catch((err) => {
  logger.fatal({ err }, "❌ Fatal error");
  process.exit(1);
});
