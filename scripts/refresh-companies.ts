import { RED_CROSS } from "@/constants/log";

import { remapStoredCompanyNames } from "./remap-company-names";

import { buildCompanyList } from "@/modules/employer/build";
import { loadUrls } from "@/utils/data";
import { logger } from "@/utils/logger";

async function main() {
  const urls = await loadUrls();
  const companies = await buildCompanyList(urls);
  const remapped = await remapStoredCompanyNames(companies);

  logger.info(remapped, "🏷️ Remapped stored job company names");
}

main().catch((err) => {
  logger.fatal({ err }, `${RED_CROSS} Fatal error`);
  process.exit(1);
});
