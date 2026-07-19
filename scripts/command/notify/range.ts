import { CONFIG } from "@/constants";

import { createSMTPTransport } from "../../utils/mail";

import { getNewJobsFromDiff } from "./git";

import { sendEmail } from "@/modules/mail-alert";
import { logger } from "@/utils/logger";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default async function notifyRange(from: string, to: string) {
  logger.info({ from, to }, "📬 Generating notification diff...");

  const jobs = getNewJobsFromDiff(from, to);

  if (jobs.length === 0) {
    logger.info("📭 No new jobs found");
    return;
  }

  logger.info({ count: jobs.length }, "📨 Sending notifications...");

  const mailer = createSMTPTransport(CONFIG.sender, { pooled: true });

  for (const job of jobs) {
    await sendEmail(job, mailer);
    await sleep(1500);
  }
  mailer.close();
  logger.info("✅ Notifications sent");
}
