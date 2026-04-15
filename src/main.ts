import type { Job } from "./types";

import { SOURCES } from "@/constants";
import parseSource from "@/modules/github-parser";
import analyzeJD from "@/modules/jd-analyzer";
import { getJobKey, groupUrlsByKey } from "@/modules/job-dedup";
import { sendEmail } from "@/modules/mail-alert";
import { loadJobs, loadUrls, saveJd } from "@/utils/data";
import { saveJob, saveUrls } from "@/utils/data";
import { getToday } from "@/utils/string";

export default async function processor(jobs: Job[] = [], main = true, isDev = false) {
  const urls = await loadUrls();
  const keys = new Set(groupUrlsByKey(Array.from(urls)).keys());
  const sent_jobs = await loadJobs();

  let currentId = sent_jobs.find((job) => job.id)?.id ?? 0;

  const newJobs: Job[] = jobs;

  if (main) {
    for (const source of SOURCES.filter((source) => !source.disabled)) {
      console.log(`🔍 Parsing ${source.name}...`);
      const jobs = await parseSource(source);
      newJobs.push(...jobs);
    }
  }

  const toSend: Job[] = [];
  for (const job of newJobs) {
    const key = getJobKey(job.link);
    if (keys.has(key)) {
      continue;
    }

    const jd = await analyzeJD(job);
    if (jd) {
      currentId += 1;
      job.id = currentId;
      job.jd = jd.jd;
      if (!job.season) {
        job.season = jd.jd.season;
      }
      await saveJd(jd.plainText, job);
    }

    toSend.push(job);
    urls.add(job.link);
    keys.add(key);
  }

  if (toSend.length === 0) {
    console.log("No new jobs to send.");
    return;
  }

  if (!isDev) {
    for (const job of toSend) {
      await sendEmail(job);
    }
    await saveUrls(urls);
  }

  await saveJob(toSend);

  console.log(`🎉 Sent ${toSend.length} new job emails for ${getToday()}`);
}
