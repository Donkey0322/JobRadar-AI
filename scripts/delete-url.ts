import path from "node:path";
import { fileURLToPath } from "node:url";

import { RED_CROSS } from "@/constants/log";

import * as store from "@/store";
import { logger } from "@/utils/logger";

export async function deleteUrl(args = process.argv.slice(2)) {
  logger.level = "silent";
  let link: string | undefined;

  // parse args
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "-l") {
      link = args[i + 1];
      i++;
    }
  }
  const sent = await store.urls.load();
  const companies = await store.companies.load();
  const opportunities = await store.opportunities.load();

  if (!link) {
    logger.fatal(`${RED_CROSS} Link is required`);
    process.exit(1);
  }

  if (sent.has(link)) {
    sent.delete(link);

    const updatedCompanies = [];
    for (const company of companies) {
      if (company.urls.includes(link)) {
        updatedCompanies.push({
          ...company,
          urls: company.urls.filter((url) => url !== link),
        });
      } else {
        updatedCompanies.push(company);
      }
    }
    await store.companies.save(updatedCompanies);

    const updatedOpportunities = opportunities.filter((opportunity) => opportunity.link !== link);
    await store.opportunities.replace(updatedOpportunities);
  }

  await store.urls.save(sent);

  return sent;
}

const isDirectRun =
  process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  deleteUrl().catch((err) => {
    logger.fatal({ err }, `${RED_CROSS} Fatal error`);
    process.exit(1);
  });
}
