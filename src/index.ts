import "dotenv/config";

import processor from "@/main";
import { logger } from "@/utils/logger";

const args = new Set(process.argv.slice(2));
const isDev = args.has("--dev");

async function main() {
  await processor([], true, isDev);
}

main().catch((err) => {
  logger.fatal({ err }, "❌ Fatal error");
  process.exit(1);
});
