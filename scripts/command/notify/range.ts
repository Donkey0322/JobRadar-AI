import { getNewJobsFromDiff } from "./git";

import { sendEmail } from "@/modules/mail-alert";
import { logger } from "@/utils/logger";

export default async function notifyRange(from: string, to: string) {
  logger.info({ from, to }, "📬 Generating notification diff...");

  const jobs = getNewJobsFromDiff(from, to);

  if (jobs.length === 0) {
    logger.info("📭 No new jobs found");
    return;
  }

  logger.info({ count: jobs.length }, "📨 Sending notifications...");

  for (const job of jobs) {
    await sendEmail(job);
  }

  logger.info("✅ Notifications sent");
}
