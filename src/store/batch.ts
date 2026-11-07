import { promises as fs } from "node:fs";
import path from "node:path";

import type { Job } from "@/types";

import { readJsonFile } from "@/store/json";
import {
  BATCH_FAILURES_PATH,
  BATCH_INFLIGHT_PATH,
  BATCH_QUEUE_PATH,
  BATCH_RESULTS_PATH,
} from "@/store/paths";
import { readNdjsonFileIfExists } from "@/utils/ndjson-archive";

function toNdjson(records: unknown[]) {
  if (records.length === 0) {
    return "";
  }

  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

async function writeFileAtomic(file: string, body: string) {
  const directory = path.dirname(file);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`
  );

  try {
    await fs.writeFile(temporary, body, "utf-8");
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

export async function loadBatchQueue(): Promise<Job[]> {
  return await readNdjsonFileIfExists<Job>(BATCH_QUEUE_PATH);
}

export async function saveBatchQueue(jobs: Job[]) {
  await fs.mkdir(path.dirname(BATCH_QUEUE_PATH), { recursive: true });
  await fs.writeFile(BATCH_QUEUE_PATH, toNdjson(jobs), "utf-8");
}

export async function loadInflightBatches<T>(): Promise<T[]> {
  let parsed: unknown;

  try {
    parsed = await readJsonFile<unknown>(BATCH_INFLIGHT_PATH);
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }

    throw new Error(`Inflight batch file is not valid JSON: ${BATCH_INFLIGHT_PATH}`, {
      cause: error,
    });
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Inflight batch file must be a JSON array: ${BATCH_INFLIGHT_PATH}`);
  }

  return parsed as T[];
}

function isMissingFile(error: unknown) {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export async function saveInflightBatches(batches: unknown[]) {
  await writeFileAtomic(BATCH_INFLIGHT_PATH, `${JSON.stringify(batches, null, 2)}\n`);
}

export async function loadBatchFailures<T>(): Promise<T[]> {
  return await readNdjsonFileIfExists<T>(BATCH_FAILURES_PATH);
}

export async function saveBatchFailures(records: unknown[]) {
  await writeFileAtomic(BATCH_FAILURES_PATH, toNdjson(records));
}

export async function loadBatchResults<T>(): Promise<T[]> {
  return await readNdjsonFileIfExists<T>(BATCH_RESULTS_PATH);
}

export async function saveBatchResults(records: unknown[]) {
  await writeFileAtomic(BATCH_RESULTS_PATH, toNdjson(records));
}

export const batchQueue = {
  load: loadBatchQueue,
  save: saveBatchQueue,
};

export const batchInflight = {
  load: loadInflightBatches,
  save: saveInflightBatches,
};

export const batchFailures = {
  load: loadBatchFailures,
  save: saveBatchFailures,
};

export const batchResults = {
  load: loadBatchResults,
  save: saveBatchResults,
};
