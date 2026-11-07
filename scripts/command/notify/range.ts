import { recordStage } from "../../github/summary";
import { createSMTPTransport } from "../../utils/mail";

import { getNewJobsFromDiff } from "./git";

import { CONFIG } from "@/config";
import { sendEmail } from "@/modules/notifier";
import { logger } from "@/utils/logger";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default async function notifyRange(from: string, to: string) {
  if (CONFIG.dashboard?.notify === false) {
    logger.info("📭 This repo does not send notifications");
    recordStage({
      stage: "notify",
      status: "skipped",
      reason: "notifications disabled",
      from,
      to,
    });
    return;
  }

  logger.info({ from, to }, "📬 Generating notification diff...");

  let jobs;
  try {
    jobs = getNewJobsFromDiff(from, to);
  } catch (error) {
    recordStage({
      stage: "notify",
      status: "failed",
      reason: "could not read the job diff",
      from,
      to,
      saved: "unchanged",
    });
    throw error;
  }

  if (jobs.length === 0) {
    logger.info("📭 No new jobs found");
    recordStage({
      stage: "notify",
      status: "success",
      reason: "no new jobs",
      from,
      to,
      candidates: 0,
      notifiedJobs: 0,
      saved: "unchanged",
    });
    return;
  }

  logger.info({ count: jobs.length }, "📨 Sending notifications...");

  const mailer = createSMTPTransport(CONFIG.sender, { pooled: true });
  let notifiedJobs = 0;
  let closed = false;

  function closeMailer() {
    if (closed) return;
    closed = true;
    mailer.close();
  }

  try {
    for (const job of jobs) {
      await sendEmail(job, mailer);
      notifiedJobs += 1;
      await sleep(1500);
    }
    closeMailer();
    recordStage({
      stage: "notify",
      status: "success",
      from,
      to,
      candidates: jobs.length,
      notifiedJobs,
      saved: "unchanged",
    });
    logger.info("✅ Notifications sent");
  } catch (error) {
    recordStage({
      stage: "notify",
      status: "failed",
      reason: "notification stopped; some messages may already have been sent",
      from,
      to,
      candidates: jobs.length,
      notifiedJobs,
      messages: "unknown",
      saved: "unchanged",
    });
    throw error;
  } finally {
    closeMailer();
  }
}
