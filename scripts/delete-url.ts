import { promises as fs } from "node:fs";

import { RED_CROSS } from "@/constants/log";

import * as store from "@/store";
import { logger } from "@/utils/logger";
import { isValidHttpUrl } from "@/utils/url";

async function readUrlLines(file: string): Promise<string[]> {
  let content: string;

  try {
    content = await fs.readFile(file, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cannot read URL file";
    logger.fatal(`${RED_CROSS} ${message}`);
    process.exit(1);
  }

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function deleteUrls(options: { links?: string[]; file?: string } = {}) {
  const optionLinks = options.links ?? [];

  if (options.file !== undefined && optionLinks.length > 0) {
    logger.fatal(`${RED_CROSS} Cannot use --link and --file together`);
    process.exit(1);
  }

  const links = options.file !== undefined ? await readUrlLines(options.file) : optionLinks;

  if (links.length === 0) {
    logger.fatal(`${RED_CROSS} Link is required`);
    process.exit(1);
  }

  const invalid = links.filter((link) => !isValidHttpUrl(link));

  if (invalid.length > 0) {
    for (const link of invalid) {
      logger.fatal(`${RED_CROSS} Invalid URL: ${link}`);
    }
    process.exit(1);
  }

  logger.level = "silent";
  const sent = await store.urls.load();
  const companies = await store.companies.load();
  const opportunities = await store.opportunities.load();
  const remove = new Set(links.filter((link) => sent.has(link)));

  for (const link of remove) {
    sent.delete(link);
  }

  const updatedCompanies = companies.map((company) => ({
    ...company,
    urls: company.urls.filter((url) => !remove.has(url)),
  }));
  const updatedOpportunities = opportunities.filter((opportunity) => !remove.has(opportunity.link));

  await store.companies.save(updatedCompanies);
  await store.opportunities.replace(updatedOpportunities);
  await store.urls.save(sent);

  return sent;
}
