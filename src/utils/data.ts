import { promises as fs } from "fs";
import path from "path";

import { COMPANY_PATH, JD_PATH, JOB_PATH, URLS_PATH } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { Company } from "@/modules/company-tacker/type";
import type { Job } from "@/types";

import { logger } from "@/utils/logger";

export async function loadUrls(): Promise<Set<string>> {
  try {
    const content = await fs.readFile(URLS_PATH, "utf-8");
    const parsed: string[] = JSON.parse(content);
    return new Set(parsed);
  } catch {
    return new Set();
  }
}

/**
 * Rewrite urls to the urls file.
 * @param urlsSet - The urls to save.
 */
export async function saveUrls(urlsSet: Set<string>) {
  const sorted = Array.from(urlsSet).sort();
  const json = JSON.stringify(sorted, null, 2);
  try {
    await fs.writeFile(URLS_PATH, json, "utf-8");
  } catch (error) {
    logger.error({ err: error }, `${RED_CROSS} Error saving urls`);
  }
}

export async function loadJobs(): Promise<Job[]> {
  try {
    const content = await fs.readFile(JOB_PATH, "utf-8");
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Job)
      .reverse();
  } catch {
    return [];
  }
}

function parseJSON(input: string): JSON | null {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

export async function saveJd(jd: string, job: Job) {
  if (!job.id) {
    logger.error(`${RED_CROSS} Job ID is required`);
    return;
  }

  try {
    const parsed = parseJSON(jd);

    if (parsed) {
      const filename = `${job.id}.json`;
      await fs.writeFile(path.join(JD_PATH, filename), JSON.stringify(parsed, null, 2), "utf-8");
    } else {
      const filename = `${job.id}.txt`;
      await fs.writeFile(path.join(JD_PATH, filename), jd, "utf-8");
    }
  } catch (error) {
    logger.error({ err: error, jobId: job.id }, `${RED_CROSS} Error saving JD`);
  }
}

/**
 * Append jobs to the end of the job file.
 * @param jobs - The jobs to save.
 */
export async function saveJob(jobs: Job[]) {
  if (jobs.length === 0) return;
  const lines = jobs.map((job) => JSON.stringify(job)).join("\n");
  await fs.appendFile(JOB_PATH, `${lines}\n`, "utf-8");
}

export async function loadCompanies(): Promise<Company[]> {
  try {
    const content = await fs.readFile(COMPANY_PATH, "utf-8");
    const parsed: Company[] = JSON.parse(content);
    return parsed;
  } catch {
    return [];
  }
}

export async function appendErrorLog(message: string) {
  // const timestamp = new Date().toISOString();
  // await fs.appendFile(ERROR_LOG_PATH, `${timestamp} ${message}\n`, "utf-8");
  logger.error({ message }, "⚠️ Error logging");
}
