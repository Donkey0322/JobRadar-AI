import type { Opportunity } from "@/types/jobs";

import { getJobKey } from "@/modules/ats/job-key";

/**
 * In-place reopens bump `postedAt` but keep their original file position.
 * New jobs are appended at the end. So an active row whose `postedAt` is newer
 * than something after it in the file was updated in place → reopen.
 */
export function detectReopenedKeys(opportunities: Opportunity[]): Set<string> {
  const reopenedKeys = new Set<string>();
  let minPostedAtToTheRight = Number.POSITIVE_INFINITY;

  for (let index = opportunities.length - 1; index >= 0; index--) {
    const job = opportunities[index]!;
    const postedAt = new Date(job.postedAt).getTime();

    if (!job.expired && !Number.isNaN(postedAt) && postedAt > minPostedAtToTheRight) {
      reopenedKeys.add(getJobKey(job.link));
    }

    if (!Number.isNaN(postedAt)) {
      minPostedAtToTheRight = Math.min(minPostedAtToTheRight, postedAt);
    }
  }

  return reopenedKeys;
}
