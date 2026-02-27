import dotenv from "dotenv";

import type { Job } from "@/types";

import { SOURCES } from "@/constants";
import { loadSent, saveSent } from "@/utils/data";
import analyzeJD from "@/utils/jd";
import { sendEmail } from "@/utils/mail";
import parseSource from "@/utils/parse";
import { getToday } from "@/utils/string";
dotenv.config();

async function main() {
  const sent = await loadSent();

  const newJobs: Job[] = [];

  for (const source of SOURCES) {
    console.log(`🔍 Parsing ${source.name}...`);
    const jobs = await parseSource(source);
    newJobs.push(...jobs);
  }

  const toSend: Job[] = [];
  for (const job of newJobs) {
    const key = job.link;
    if (key in sent) {
      continue;
    }

    const jd = await analyzeJD(job);
    job.jd = jd;
    if (!job.season) {
      job.season = jd?.season;
    }

    toSend.push(job);
    sent.add(key);
  }

  if (toSend.length === 0) {
    console.log("No new jobs to send.");
    return;
  }

  for (const job of toSend) {
    await sendEmail(job);
  }

  await saveSent(sent);
  console.log(`🎉 Sent ${toSend.length} new job emails for ${getToday()}`);
}

main();
