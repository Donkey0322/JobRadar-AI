import "dotenv/config";

import { buildCompanyList } from "@/modules/company-tacker/company";
import { loadUrls } from "@/utils/data";
import { logger } from "@/utils/logger";

async function main() {
  const urls = await loadUrls();
  const links = Array.from(urls);

  const companies = await buildCompanyList(links);
  logger.info({ count: companies.length }, "✅ Successfully built companies");
}

main().catch((err) => {
  logger.fatal({ err }, "❌ Fatal error");
  process.exit(1);
});
