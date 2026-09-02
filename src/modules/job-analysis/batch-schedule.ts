import { promises as fs } from "node:fs";
import path from "node:path";

import { BATCH_SCHEDULE_PATH } from "@/constants";

import { readJsonFile } from "@/utils/data";

/** GitHub Actions will not run scheduled workflows more often than every 5 minutes. */
export const BATCH_MIN_INTERVAL_MS = 5 * 60 * 1000;
export const BATCH_MAX_INTERVAL_MS = 60 * 60 * 1000;

export interface BatchSchedule {
  intervalMs: number;
  nextCheckAt: string;
  lastDurationMs: number | null;
}

export function defaultBatchSchedule(): BatchSchedule {
  return {
    intervalMs: BATCH_MAX_INTERVAL_MS,
    nextCheckAt: new Date(0).toISOString(),
    lastDurationMs: null,
  };
}

export function clampBatchInterval(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return BATCH_MIN_INTERVAL_MS;
  }

  return Math.min(BATCH_MAX_INTERVAL_MS, Math.max(BATCH_MIN_INTERVAL_MS, Math.round(ms)));
}

export function isBatchCheckDue(schedule: BatchSchedule, now = Date.now()) {
  const at = Date.parse(schedule.nextCheckAt);

  if (!Number.isFinite(at)) {
    return true;
  }

  return now >= at;
}

export function planNextBatchCheck(input: {
  previous: BatchSchedule;
  checkedTooEarly: boolean;
  hasInflight: boolean;
  submitted: number;
  completedDurationMs: number | null;
  now?: number;
}): BatchSchedule {
  const now = input.now ?? Date.now();
  const lastDurationMs = input.completedDurationMs ?? input.previous.lastDurationMs;

  let intervalMs: number;

  if (input.checkedTooEarly) {
    intervalMs = clampBatchInterval(input.previous.intervalMs * 2);
  } else if (input.hasInflight || input.submitted > 0) {
    intervalMs = clampBatchInterval(
      input.completedDurationMs ?? input.previous.lastDurationMs ?? BATCH_MIN_INTERVAL_MS
    );
  } else {
    intervalMs = BATCH_MAX_INTERVAL_MS;
  }

  return {
    intervalMs,
    lastDurationMs,
    nextCheckAt: new Date(now + intervalMs).toISOString(),
  };
}

export async function loadBatchSchedule(): Promise<BatchSchedule> {
  try {
    const parsed = await readJsonFile<Partial<BatchSchedule>>(BATCH_SCHEDULE_PATH);

    return {
      intervalMs: clampBatchInterval(Number(parsed.intervalMs) || BATCH_MAX_INTERVAL_MS),
      nextCheckAt:
        typeof parsed.nextCheckAt === "string" ? parsed.nextCheckAt : new Date(0).toISOString(),
      lastDurationMs:
        typeof parsed.lastDurationMs === "number" && Number.isFinite(parsed.lastDurationMs)
          ? parsed.lastDurationMs
          : null,
    };
  } catch {
    return defaultBatchSchedule();
  }
}

export async function saveBatchSchedule(schedule: BatchSchedule) {
  await fs.mkdir(path.dirname(BATCH_SCHEDULE_PATH), { recursive: true });
  await fs.writeFile(BATCH_SCHEDULE_PATH, `${JSON.stringify(schedule, null, 2)}\n`, "utf-8");
}
