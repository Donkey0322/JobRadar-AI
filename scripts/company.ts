import { GREEN_CHECKMARK, RED_CROSS } from "@/constants/log";

import { buildCompanyList } from "@/modules/company-tacker/company";
import { loadUrls } from "@/utils/data";
import { logger } from "@/utils/logger";

async function main() {
  const urls = await loadUrls();
  const companies = await buildCompanyList(urls);
  logger.info({ count: companies.length }, `${GREEN_CHECKMARK} Successfully built companies`);
}

main().catch((err) => {
  logger.fatal({ err }, `${RED_CROSS} Fatal error`);
  process.exit(1);
});
