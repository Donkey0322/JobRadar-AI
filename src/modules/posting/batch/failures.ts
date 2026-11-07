import type { PostingAnalysisFailure } from "@/modules/posting/analysis/analyze";
import type { Job } from "@/types";

import { getJobKey } from "@/modules/ats/job-key";
import { batchFailures } from "@/store/batch";

/**
 * Attempts a batch job gets per round, the first one included, before it is set aside.
 * JD fetches and AI calls share this budget. A fetch that later reaches analysis does
 * not start a new round; only `markRetried` does. Switching stages therefore cannot
 * reset the count and retry without limit.
 */
export const BATCH_MAX_ATTEMPTS = 3;

export interface BatchAttempt {
  /**
   * Provider batch name, `realtime:<uuid>` for one real-time call, or `fetch:<uuid>`
   * for one JD fetch. An id is counted once for the life of the record, across
   * restarts and manual retries. Replaying a saved fetch does not create an id.
   */
  id: string;
  at: string;
  failure: PostingAnalysisFailure;
  cost: number;
  /** `manualRetries` when the attempt was made. Older lines without it are read as the current round. */
  round: number;
}

/**
 * One line of `data/batch/failures.ndjson`, keyed by job key. `retrying` jobs are
 * queued or inflight. `failed` jobs wait for `pnpm jobctl batch --retry-failed`.
 */
export interface BatchFailure {
  key: string;
  job: Job;
  status: "retrying" | "failed";
  /** The latest failure. */
  failure: PostingAnalysisFailure;
  /** Every counted attempt, including rounds before a manual retry. */
  attempts: BatchAttempt[];
  /** Known cost of every counted attempt. */
  cost: number;
  firstFailedAt: string;
  lastFailedAt: string;
  /** Manual retries so far. It is also the current round. */
  manualRetries: number;
  /**
   * Earliest time a retryable failure may be fetched again. Absent on older
   * records and after a manual retry, which both mean "ready now".
   */
  nextAttemptAt?: string;
}

export function toQueuedJob(job: Job): Job {
  return {
    company: job.company,
    role: job.role,
    link: job.link,
    location: job.location,
    ...(job.country ? { country: job.country } : {}),
  };
}

export function roundAttempts(record: BatchFailure): BatchAttempt[] {
  return record.attempts.filter((attempt) => attempt.round === record.manualRetries);
}

function readRecord(record: BatchFailure): BatchFailure {
  return {
    ...record,
    attempts: record.attempts.map((attempt) => ({
      ...attempt,
      round: attempt.round ?? record.manualRetries,
    })),
  };
}

export class BatchFailures {
  #records: Map<string, BatchFailure>;
  #changed = false;

  private constructor(records: BatchFailure[]) {
    this.#records = new Map(records.map((record) => [record.key, readRecord(record)]));
  }

  static async load(): Promise<BatchFailures> {
    return new BatchFailures(await batchFailures.load<BatchFailure>());
  }

  get(job: Job): BatchFailure | undefined {
    return this.#records.get(getJobKey(job.link));
  }

  /**
   * Adds a failed attempt to the current round. `counted` is false when the attempt id
   * is already recorded, so the same provider result never costs or counts twice.
   */
  record(
    job: Job,
    attempt: Omit<BatchAttempt, "round">
  ): { record: BatchFailure; counted: boolean } {
    const key = getJobKey(job.link);
    const current = this.#records.get(key);

    if (current?.attempts.some((item) => item.id === attempt.id)) {
      return { record: current, counted: false };
    }

    const round = current?.manualRetries ?? 0;
    const next: BatchFailure = {
      key,
      job: current?.job ?? toQueuedJob(job),
      status: "retrying",
      failure: attempt.failure,
      attempts: [...(current?.attempts ?? []), { ...attempt, round }],
      cost: (current?.cost ?? 0) + attempt.cost,
      firstFailedAt: current?.firstFailedAt ?? attempt.at,
      lastFailedAt: attempt.at,
      manualRetries: round,
    };

    if (roundAttempts(next).length >= BATCH_MAX_ATTEMPTS) {
      next.status = "failed";
    }

    this.#records.set(key, next);
    this.#changed = true;
    return { record: next, counted: true };
  }

  /** Keeps a retrying job from being fetched again until `nextAttemptAt`. */
  schedule(job: Job, nextAttemptAt: string) {
    const current = this.#records.get(getJobKey(job.link));

    if (!current || current.status === "failed") {
      return;
    }

    this.#records.set(current.key, { ...current, nextAttemptAt });
    this.#changed = true;
  }

  /** Stops the current round before it has used every attempt. A 404 or 403 takes this path. */
  finish(job: Job): BatchFailure | undefined {
    const current = this.#records.get(getJobKey(job.link));

    if (!current || current.status === "failed") {
      return current;
    }

    const next = { ...current, status: "failed" as const };
    delete next.nextAttemptAt;
    this.#records.set(current.key, next);
    this.#changed = true;
    return next;
  }

  clear(key: string) {
    if (this.#records.delete(key)) {
      this.#changed = true;
    }
  }

  list(): BatchFailure[] {
    return [...this.#records.values()];
  }

  failed(): BatchFailure[] {
    return this.list().filter((record) => record.status === "failed");
  }

  /** Starts a new round for failed jobs. Call after they are back in the queue. */
  markRetried(records: BatchFailure[]) {
    for (const record of records) {
      const next = {
        ...record,
        status: "retrying" as const,
        manualRetries: record.manualRetries + 1,
      };
      delete next.nextAttemptAt;
      this.#records.set(record.key, next);
      this.#changed = true;
    }
  }

  async save() {
    if (!this.#changed) {
      return;
    }

    await batchFailures.save([...this.#records.values()]);
    this.#changed = false;
  }
}
