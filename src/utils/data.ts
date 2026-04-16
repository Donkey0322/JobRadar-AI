import { promises as fs } from "fs";
import path from "path";

import type { Company } from "@/modules/company-tacker/type";
import type { Job } from "@/types";

import { COMPANY_PATH, JD_PATH, JOB_PATH, URLS_PATH } from "@/constants";
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

export async function saveUrls(urlsSet: Set<string>) {
  const sorted = Array.from(urlsSet).sort();
  const json = JSON.stringify(sorted, null, 2);
  try {
    await fs.writeFile(URLS_PATH, json, "utf-8");
  } catch (error) {
    logger.error({ err: error }, "❌ Error saving urls");
  }
}

export async function loadJobs(): Promise<Job[]> {
  try {
    const content = await fs.readFile(JOB_PATH, "utf-8");
    const parsed: Job[] = JSON.parse(content);
    return parsed;
  } catch {
    return [];
  }
}

export async function saveJd(jd: string, job: Job) {
  if (!job.id) {
    logger.error("❌ Job ID is required");
    return;
  }
  try {
    const filename = `${job.id}.txt`;
    await fs.writeFile(path.join(JD_PATH, filename), jd, "utf-8");
  } catch (error) {
    logger.error({ err: error, jobId: job.id }, "❌ Error saving JD");
  }
}

export async function saveJob(jobs: Job[]) {
  try {
    const content = await fs.readFile(JOB_PATH, "utf-8");
    const parsed: Job[] = JSON.parse(content);
    const reversed = parsed.reverse();
    reversed.push(...jobs);
    await fs.writeFile(JOB_PATH, JSON.stringify(reversed.reverse(), null, 2), "utf-8");
  } catch {
    await fs.writeFile(JOB_PATH, JSON.stringify(jobs, null, 2), "utf-8");
  }
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
