import type { Job } from "@/types";

import { ARCHIVE_PATH, JOB_ARCHIVE_CHUNK, JOB_PATH } from "@/store/paths";
import {
  appendNdjsonPartitions,
  loadNdjsonPartitions,
  writeNdjsonPartitions,
} from "@/utils/ndjson-archive";

export async function loadJobs(): Promise<Job[]> {
  try {
    return (await loadNdjsonPartitions<Job>(JOB_PATH, ARCHIVE_PATH, "jobs")).reverse();
  } catch {
    return [];
  }
}

/**
 * Read jobs in file order (not reversed). Used when rewriting the job file.
 */
export async function loadJobsInFileOrder(): Promise<Job[]> {
  try {
    return await loadNdjsonPartitions<Job>(JOB_PATH, ARCHIVE_PATH, "jobs");
  } catch {
    return [];
  }
}

/** Append jobs. An empty list does not touch the file. */
export async function appendJobs(jobs: Job[]) {
  if (jobs.length === 0) return;

  await appendNdjsonPartitions(JOB_PATH, ARCHIVE_PATH, "jobs", jobs, JOB_ARCHIVE_CHUNK);
}

/** Replace the job file, including an empty list. */
export async function replaceJobs(jobs: Job[]) {
  await writeNdjsonPartitions(JOB_PATH, ARCHIVE_PATH, "jobs", jobs, JOB_ARCHIVE_CHUNK);
}

export const jobs = {
  load: loadJobs,
  loadInFileOrder: loadJobsInFileOrder,
  append: appendJobs,
  replace: replaceJobs,
};
