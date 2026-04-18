import { SOURCES } from "@/constants";

import type { Job } from "./types";

import parseSource from "@/modules/github-parser";
import analyzeJD from "@/modules/jd-analyzer";
import { getJobKey, groupUrlsByKey } from "@/modules/job-dedup";
import { sendEmail } from "@/modules/mail-alert";
import { loadJobs, loadUrls, saveJd } from "@/utils/data";
import { saveJob, saveUrls } from "@/utils/data";
import { logger } from "@/utils/logger";
import { getToday } from "@/utils/string";

export default async function processor(jobs: Job[] = [], main = true, isDev = false) {
  logger.info("🔍 Starting processor");
  const urls = await loadUrls();
  const keys = new Set(groupUrlsByKey(Array.from(urls)).keys());
  const sent_jobs = await loadJobs();

  let currentId = sent_jobs.find((job) => job.id)?.id ?? 0;

  const newJobs: Job[] = jobs;

  if (main) {
    for (const source of SOURCES.filter((source) => !source.disabled)) {
      logger.info({ source: source.name }, "🔍 Parsing github source");
      const jobs = await parseSource(source);
      newJobs.push(...jobs);
    }
  }

  const toSend: Job[] = [];
  let totalCost = 0;
  for (const job of newJobs) {
    const key = getJobKey(job.link);
    if (keys.has(key)) {
      continue;
    }

    const { jd, rawJD, cost } = await analyzeJD(job);
    totalCost += cost;
    if (jd) {
      currentId += 1;
      job.id = currentId;
      job.jd = jd;
      if (!job.season) {
        job.season = jd.season;
      }
      await saveJd(rawJD, job);
    }

    toSend.push(job);
    urls.add(job.link);
    keys.add(key);
  }

  if (toSend.length === 0) {
    logger.info("🕳️ No new jobs to send.");
    return;
  }

  if (!isDev) {
    for (const job of toSend) {
      await sendEmail(job);
    }
    logger.info({ count: toSend.length, date: getToday() }, "✉️ Sent new job emails");
  }
  await saveUrls(urls);
  await saveJob(toSend);
  logger.info({ totalCost }, "💰 Processed jobs: Total cost");
}
