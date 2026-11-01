import {
  canonicalGreenhouseJobUrl,
  greenhousePostingFromHtml,
} from "@/modules/employer/shared/greenhouse";
import { getJobKey } from "@/utils/job-key";
import { logger } from "@/utils/logger";
import { getHostnameWithoutWww } from "@/utils/url";

/** Apply redirectors. The host is not the employer. */
const SHORT_LINK_HOSTS = new Set(["go.vansh.nyc"]);
const MAX_HOPS = 5;

const REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (JD-Analyzer)",
  "Accept-Encoding": "identity",
} as const;

export function isApplyShortLink(link: string): boolean {
  try {
    return SHORT_LINK_HOSTS.has(getHostnameWithoutWww(new URL(link)));
  } catch {
    return false;
  }
}

/**
 * Follow an apply short link until it leaves the redirector.
 * A failed lookup keeps the original link.
 */
export async function resolveApplyLink(link: string): Promise<string> {
  if (!isApplyShortLink(link)) return link;

  let current = link;

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (!isApplyShortLink(current)) return current;

    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        headers: REQUEST_HEADERS,
      });
    } catch (err) {
      logger.warn({ link: current, err }, "Failed to resolve apply short link");
      return link;
    }

    if (response.status < 300 || response.status >= 400) {
      return current;
    }

    const location = response.headers.get("location");
    if (!location) return current;

    try {
      current = new URL(location, current).toString();
    } catch {
      return link;
    }
  }

  return current;
}

function hasStableJobKey(link: string): boolean {
  return !getJobKey(link).includes("://");
}

/**
 * Unwrap an apply redirect, then rewrite a career page to the Greenhouse job
 * URL when the page names a board and requisition.
 */
export async function canonicalizeApplyLink(link: string): Promise<string> {
  const resolved = await resolveApplyLink(link);
  if (hasStableJobKey(resolved)) return resolved;

  let response: Response;
  try {
    response = await fetch(resolved, {
      redirect: "follow",
      headers: REQUEST_HEADERS,
    });
  } catch (err) {
    logger.warn({ link: resolved, err }, "Failed to read apply page");
    return resolved;
  }

  const landed = response.url || resolved;
  if (hasStableJobKey(landed)) return landed;
  if (!response.ok) return resolved;

  const posting = greenhousePostingFromHtml(landed, await response.text());
  if (!posting) return resolved;

  return canonicalGreenhouseJobUrl(landed, posting);
}
