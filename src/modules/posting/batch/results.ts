import type { JD, Job } from "@/types";

import { getJobKey } from "@/modules/ats/job-key";
import { toQueuedJob } from "@/modules/posting/batch/failures";
import { batchResults } from "@/store/batch";

/**
 * One line of `data/batch/results.ndjson`: a valid real-time JD that is not in jobs and
 * opportunities yet. It is replayed before any new analysis of the same job.
 */
export interface PendingResult {
  key: string;
  job: Job;
  jd: JD;
  /** `realtime:<uuid>` of the call that returned this JD. */
  attemptId: string;
  cost: number;
  analyzedAt: string;
}

export class PendingResults {
  #records: Map<string, PendingResult>;
  #changed = false;

  private constructor(records: PendingResult[]) {
    this.#records = new Map(records.map((record) => [record.key, record]));
  }

  static async load(): Promise<PendingResults> {
    return new PendingResults(await batchResults.load<PendingResult>());
  }

  has(job: Job): boolean {
    return this.#records.has(getJobKey(job.link));
  }

  list(): PendingResult[] {
    return [...this.#records.values()];
  }

  add(job: Job, result: Omit<PendingResult, "key" | "job">) {
    const key = getJobKey(job.link);
    this.#records.set(key, { key, job: toQueuedJob(job), ...result });
    this.#changed = true;
  }

  remove(keys: Iterable<string>) {
    for (const key of keys) {
      if (this.#records.delete(key)) {
        this.#changed = true;
      }
    }
  }

  async save() {
    if (!this.#changed) {
      return;
    }

    await batchResults.save(this.list());
    this.#changed = false;
  }
}
