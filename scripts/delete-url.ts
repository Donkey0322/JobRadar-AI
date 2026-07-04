import { RED_CROSS } from "@/constants/log";

import {
  loadCompanies,
  loadOpportunities,
  loadUrls,
  saveCompanies,
  saveOpportunities,
} from "@/utils/data";
import { saveUrls } from "@/utils/data";
import { logger } from "@/utils/logger";

async function main() {
  const args = process.argv.slice(2);
  let link: string | undefined;

  // parse args
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "-l") {
      link = args[i + 1];
      i++;
    }
  }
  const sent = await loadUrls();
  const companies = await loadCompanies();
  const opportunities = await loadOpportunities();

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
    await saveCompanies(updatedCompanies);

    const updatedOpportunities = opportunities.filter((opportunity) => opportunity.link !== link);
    await saveOpportunities(updatedOpportunities, true);
  }

  await saveUrls(sent);

  return sent;
}

// set silent to true
logger.level = "silent";
main().catch((err) => {
  logger.fatal({ err }, `${RED_CROSS} Fatal error`);
  process.exit(1);
});
