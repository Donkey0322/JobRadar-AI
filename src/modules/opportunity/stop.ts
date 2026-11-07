import type { JDFetchStatus } from "@/modules/posting/jd";
import type { Job, Opportunity, OpportunityStop } from "@/types";

import { getJobKey } from "@/modules/ats/job-key";
import { isExplicitJDRemoval, isTemporaryJDFetch } from "@/modules/posting/jd";
import { opportunities } from "@/store/opportunities";
import { ARCHIVE_PATH, OPPORTUNITIES_PATH } from "@/store/paths";
import { loadNdjsonPartitions } from "@/utils/ndjson-archive";

/** Stop record for a fetch that will not be tried again in this round. */
export function terminalOpportunityStop(error: JDFetchStatus, at: string): OpportunityStop {
  const reason = isExplicitJDRemoval(error)
    ? "gone"
    : isTemporaryJDFetch(error)
      ? "exhausted"
      : "undetermined";

  return {
    reason,
    code: error.code,
    ...(error.failure ? { failure: error.failure } : {}),
    at,
  };
}

/**
 * True when this row already has the stop `saveOpportunityStop` would write for
 * `error` at `at`. Reason, code, failure, and at all have to match. An explicit
 * removal is saved only with `expired: true`. Any other reason keeps the row's
 * existing expired flag, so that flag is not required to change.
 */
export function opportunityStopSaved(
  row:
    | {
        expired?: boolean;
        stop?: {
          reason?: string;
          code?: number;
          failure?: string;
          at?: string;
        };
      }
    | undefined,
  error: JDFetchStatus,
  at: string
): boolean {
  const expected = terminalOpportunityStop(error, at);
  const stop = row?.stop;

  if (!stop) {
    return false;
  }

  if (stop.reason !== expected.reason || stop.code !== expected.code || stop.at !== expected.at) {
    return false;
  }

  if (stop.failure !== expected.failure) {
    return false;
  }

  if (expected.reason === "gone") {
    return row?.expired === true;
  }

  return true;
}

/**
 * Writes the stop onto the first opportunity for this job, then replaces the dataset.
 * Throws when the dataset cannot be read or written, so the caller can keep the job queued.
 * An explicit 404 or 410 also marks the row expired. Other stops do not.
 */
export async function saveOpportunityStop(job: Job, stop: OpportunityStop): Promise<void> {
  const rows = await loadNdjsonPartitions<Opportunity>(
    OPPORTUNITIES_PATH,
    ARCHIVE_PATH,
    "opportunities"
  );
  const key = getJobKey(job.link);
  let found = false;
  const next = rows.map((row) => {
    if (found || getJobKey(row.link) !== key) {
      return row;
    }

    found = true;
    return {
      ...row,
      stop,
      expired: stop.reason === "gone" ? true : row.expired,
    };
  });

  if (!found) {
    next.push({
      company: job.company,
      role: job.role,
      link: job.link,
      location: job.location,
      ...(job.country ? { country: job.country } : {}),
      postedAt: stop.at,
      expired: stop.reason === "gone",
      stop,
    });
  }

  await opportunities.replace(next);
}
