import { getJobKey } from "@/modules/ats/job-key";

/**
 * A followed redirect left the posting when the landed URL is a different job.
 * Fetch already followed the hops. Missing `response.url` keeps the requested URL.
 */
export function landedOnSameJob(requested: string, landed: string | undefined): boolean {
  if (!landed) return true;
  return getJobKey(requested) === getJobKey(landed);
}
