import "dotenv/config";
import { RED_CROSS } from "./constants/log";

import processor from "@/main";
import { logger } from "@/utils/logger";

const args = new Set(process.argv.slice(2));
const isDev = args.has("--dev");

async function main() {
  await processor([], true, isDev);
}

main().catch((err) => {
  logger.fatal({ err }, `${RED_CROSS} Fatal error`);
  process.exit(1);
});
