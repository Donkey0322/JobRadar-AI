import { promises as fs } from "fs";
import path from "path";

import {
  COMPANY_PATH,
  ERROR_LOG_PATH,
  JD_PATH,
  JOB_PATH,
  OPPORTUNITIES_PATH,
  URLS_PATH,
} from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { Company } from "@/modules/company-tacker/type";
import type { Job } from "@/types";

import { logger } from "@/utils/logger";

/**
 * Read and parse a JSON file. File-system and parse errors are propagated.
 */
export async function readJsonFile<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, "utf-8");
  return JSON.parse(content) as T;
}

/**
 * Read and parse an NDJSON file. Blank lines are ignored; file-system and
 * parse errors are propagated.
 */
export async function readNdjsonFile<T>(filePath: string): Promise<T[]> {
  const content = await fs.readFile(filePath, "utf-8");

  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as T;
      } catch (error) {
        throw new Error(`Invalid NDJSON at line ${index + 1}: ${line}`, {
          cause: error,
        });
      }
    });
}

export async function loadUrls(): Promise<Set<string>> {
  try {
    const parsed = await readJsonFile<string[]>(URLS_PATH);
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
    return (await readNdjsonFile<Job>(JOB_PATH)).reverse();
  } catch {
    return [];
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

export async function readJD(id: number): Promise<string | null> {
  try {
    const content = await fs.readFile(path.join(JD_PATH, `${id}.txt`), "utf-8");
    return content;
  } catch {
    return null;
  }
}

function parseJSON(input: string): JSON | null {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

export async function saveJD(jd: string, job: Job) {
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

export async function loadOpportunities(): Promise<Job[]> {
  try {
    return await readNdjsonFile<Job>(OPPORTUNITIES_PATH);
  } catch {
    return [];
  }
}

export async function saveOpportunities(opportunities: Job[], overwrite: boolean = false) {
  if (opportunities.length === 0) return;
  const lines = opportunities.map((opportunity) => JSON.stringify(opportunity)).join("\n");
  if (overwrite) {
    await fs.writeFile(OPPORTUNITIES_PATH, `${lines}\n`, "utf-8");
  } else {
    await fs.appendFile(OPPORTUNITIES_PATH, `${lines}\n`, "utf-8");
  }
}

export async function loadCompanies(): Promise<Company[]> {
  try {
    return await readJsonFile<Company[]>(COMPANY_PATH);
  } catch {
    return [];
  }
}

export async function saveCompanies(companies: Company[]) {
  try {
    await fs.writeFile(COMPANY_PATH, JSON.stringify(companies, null, 2), "utf-8");
  } catch (error) {
    logger.error({ err: error }, `${RED_CROSS} Error saving companies`);
  }
}

export async function appendErrorLog(message: string) {
  if (!process.stdout.isTTY) {
    return;
  }
  const timestamp = new Date().toISOString();
  await fs.appendFile(ERROR_LOG_PATH, `${timestamp} ${message}\n`, "utf-8");
}
