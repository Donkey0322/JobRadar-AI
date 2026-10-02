import type { Company } from "@/types";

import { getATSFetcher } from "@/modules/ats/core";
import { getJobKey } from "@/utils/job-key";

export function partitionUrlsByListedKeys(
  urls: readonly string[],
  listedKeys: ReadonlySet<string> | null
): { listed: string[]; unverified: string[] } {
  if (!listedKeys) {
    return { listed: [], unverified: [...urls] };
  }

  const listed: string[] = [];
  const unverified: string[] = [];

  for (const url of urls) {
    if (listedKeys.has(getJobKey(url))) {
      listed.push(url);
    } else {
      unverified.push(url);
    }
  }

  return { listed, unverified };
}

export async function checkUrlsAgainstListing(
  company: Company,
  urls: readonly string[],
  signal: AbortSignal
): Promise<{ listed: string[]; unverified: string[] }> {
  if (!company.page || urls.length === 0) {
    return { listed: [], unverified: [...urls] };
  }

  const listedKeys = await getATSFetcher(company.ats).listJobKeys(company, signal);
  return partitionUrlsByListedKeys(urls, listedKeys);
}
