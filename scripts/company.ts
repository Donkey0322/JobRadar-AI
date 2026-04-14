import "dotenv/config";

import { buildCompanyList } from "../src/modules/company-tacker/company";
import { loadUrls } from "../src/utils/data";

async function main() {
  const urls = await loadUrls();
  const links = Array.from(urls);

  const companies = await buildCompanyList(links);
  console.log(`🎉 Built ${companies.length} companies`);
}

main();
