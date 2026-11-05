import { promises as fs } from "node:fs";
import path from "node:path";

import type { Job } from "@/types";

import { readJsonFile } from "@/store/json";
import { BATCH_INFLIGHT_PATH, BATCH_QUEUE_PATH } from "@/store/paths";
import { readNdjsonFileIfExists } from "@/utils/ndjson-archive";

function toNdjson(records: unknown[]) {
  if (records.length === 0) {
    return "";
  }

  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
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
  const directory = path.dirname(BATCH_INFLIGHT_PATH);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(BATCH_INFLIGHT_PATH)}.${process.pid}.${Date.now()}.tmp`
  );
  const body = `${JSON.stringify(batches, null, 2)}\n`;

  try {
    await fs.writeFile(temporary, body, "utf-8");
    await fs.rename(temporary, BATCH_INFLIGHT_PATH);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

export const batchQueue = {
  load: loadBatchQueue,
  save: saveBatchQueue,
};

export const batchInflight = {
  load: loadInflightBatches,
  save: saveInflightBatches,
};
