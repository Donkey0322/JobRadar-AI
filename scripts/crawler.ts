import "dotenv/config";
import { RED_CROSS } from "@/constants/log";

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
  logger.fatal({ err }, `${RED_CROSS} Fatal error`);
  process.exit(1);
});
