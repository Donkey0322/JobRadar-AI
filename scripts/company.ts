#!/usr/bin/env tsx

import "dotenv/config";

import { buildCompanyList } from "../src/modules/company-tacker/company";
import { loadSent } from "../src/utils/data";

async function main() {
  const urls = await loadSent();
  const links = Array.from(urls);

  const companies = await buildCompanyList(links);
  console.log(`🎉 Built ${companies.length} companies`);
}

main();
