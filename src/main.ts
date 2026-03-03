import "dotenv/config";

import type { Job } from "@/types";

import { SOURCES } from "@/constants";
import { loadSent, saveJob, saveSent } from "@/utils/data";
import analyzeJD from "@/utils/jd";
import { sendEmail } from "@/utils/mail";
import parseSource from "@/utils/parse";
import { getToday } from "@/utils/string";

const args = new Set(process.argv.slice(2));
const isDev = args.has("--dev");

async function main() {
  const sent = await loadSent();
  let currentId = sent.size;

  const newJobs: Job[] = [];

  for (const source of SOURCES.filter((source) => !source.disabled)) {
    console.log(`🔍 Parsing ${source.name}...`);
    const jobs = await parseSource(source);
    newJobs.push(...jobs);
  }

  const toSend: Job[] = [];
  for (const job of newJobs) {
    const key = job.link;
    if (sent.has(key)) {
      continue;
    }

    currentId += 1;
    job.id = currentId;

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

  if (!isDev) {
    for (const job of toSend) {
      await sendEmail(job);
    }
    await saveSent(sent);
  }

  await saveJob(toSend);

  console.log(`🎉 Sent ${toSend.length} new job emails for ${getToday()}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
