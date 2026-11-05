import { RED_CROSS } from "@/constants/log";

import { logger } from "@/utils/logger";
import { isValidHttpUrl } from "@/utils/url";

export function rejectInvalidUrls(links: string[]) {
  const invalid = links.filter((link) => !isValidHttpUrl(link));

  if (invalid.length === 0) return;

  for (const link of invalid) {
    logger.error(`${RED_CROSS} Invalid URL: ${link}`);
  }

  process.exit(1);
}
