import { RED_CROSS } from "@/constants/log";

import { buildCompanyList } from "@/modules/company-tacker/company";
import { loadUrls } from "@/utils/data";
import { logger } from "@/utils/logger";

async function main() {
  const urls = await loadUrls();
  await buildCompanyList(urls);
}

main().catch((err) => {
  logger.fatal({ err }, `${RED_CROSS} Fatal error`);
  process.exit(1);
});
