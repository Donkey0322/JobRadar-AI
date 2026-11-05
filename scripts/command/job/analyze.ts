import { RED_CROSS } from "@/constants/log";

import { rejectInvalidUrls } from "./input";

import { analyzeLink } from "@/modules/posting";
import { logger } from "@/utils/logger";

export async function analyzeJobs(links: string[]) {
  if (links.length === 0) {
    logger.error(`${RED_CROSS} Link is required`);
    process.exit(1);
  }

  rejectInvalidUrls(links);

  for (const link of links) {
    const jd = await analyzeLink(link);

    if (!jd) {
      logger.info({ url: link }, `${RED_CROSS} No result`);
      continue;
    }

    logger.info({ url: link }, "\n ✏️ Result:\n%s", JSON.stringify(jd, null, 2));
  }
}
