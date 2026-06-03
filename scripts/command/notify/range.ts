import nodemailer from "nodemailer";

import { CONFIG } from "@/constants";

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

  const smtpHost = CONFIG.sender.host;
  const smtpPort = CONFIG.sender.port;
  const smtpUser = CONFIG.sender.user;
  const smtpPass = CONFIG.sender.pass;

  const mailer = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,

    pool: true,
    maxConnections: 1,
    maxMessages: Infinity,

    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  for (const job of jobs) {
    await sendEmail(job, mailer);
    await sleep(1500);
  }
  mailer.close();
  logger.info("✅ Notifications sent");
}
