import type { Company } from "@/types";

import { errorLog } from "@/store";
import { connectionErrorMessage } from "@/utils/http";

function statusMessage(res: Response, detail?: string): string {
  return `${res.status} - ${res.statusText}${detail ? ` (${detail})` : ""}`;
}

/** A listing request answered with an error status, as opposed to a crash or abort. */
export class ListingHttpError extends Error {
  static from(res: Response, detail?: string): ListingHttpError {
    return new ListingHttpError(statusMessage(res, detail));
  }
}

/** One error-log line for a listing that answered with an error status. */
export async function logListingStatus(
  label: string,
  company: Company,
  res: Response,
  detail?: string
): Promise<void> {
  await errorLog.append(`${label}: ${company.name} - ${statusMessage(res, detail)}`);
}

/**
 * Writes HTTP failures and unreachable hosts (DNS, TLS, refused) as one
 * error-log line. Returns false for anything else, which callers still
 * report with a stack trace.
 */
export async function logListingFailure(
  label: string,
  company: Company,
  error: unknown
): Promise<boolean> {
  const message = error instanceof ListingHttpError ? error.message : connectionErrorMessage(error);
  if (!message) return false;

  await errorLog.append(`${label}: ${company.name} - ${message}`);
  return true;
}
