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
  try {
    return await readJsonFile<T[]>(BATCH_INFLIGHT_PATH);
  } catch {
    return [];
  }
}

export async function saveInflightBatches(batches: unknown[]) {
  await fs.mkdir(path.dirname(BATCH_INFLIGHT_PATH), { recursive: true });
  await fs.writeFile(BATCH_INFLIGHT_PATH, `${JSON.stringify(batches, null, 2)}\n`, "utf-8");
}

export const batchQueue = {
  load: loadBatchQueue,
  save: saveBatchQueue,
};

export const batchInflight = {
  load: loadInflightBatches,
  save: saveInflightBatches,
};
