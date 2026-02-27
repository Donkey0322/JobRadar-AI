import { promises as fs } from "fs";
import parseSource from "@/utils/parse";
import analyzeJD from "@/utils/jd";
import { SOURCES, SENT_PATH } from "@/constants";
import type { Job } from "@/types";
import { sendEmail } from "@/utils/mail";
import dotenv from "dotenv";
import { getToday } from "@/utils/string";
dotenv.config();

async function loadSent(): Promise<Set<string>> {
  try {
    const content = await fs.readFile(SENT_PATH, "utf-8");
    const parsed: string[] = JSON.parse(content);
    return new Set(parsed);
  } catch {
    return new Set();
  }
}

export async function saveSent(sentSet: Set<string>) {
  const sorted = Array.from(sentSet).sort();
  const json = JSON.stringify(sorted, null, 2);
  await fs.writeFile(SENT_PATH, json, "utf-8");
}

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
