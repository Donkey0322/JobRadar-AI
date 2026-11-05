import type { ListingScan } from "./listing-scan";
import type { Company } from "@/types";

import { asBoard } from "./registry";

import { getJobKey } from "@/modules/ats/job-key";

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
  signal: AbortSignal,
  scan?: ListingScan
): Promise<{ listed: string[]; unverified: string[] }> {
  if (!company.page || urls.length === 0) {
    return { listed: [], unverified: [...urls] };
  }

  const listedKeys = await asBoard(company).listedKeys(signal, {
    targetKeys: scan?.targetKeys ?? new Set(urls.map((url) => getJobKey(url))),
    onPage: scan?.onPage,
  });
  return partitionUrlsByListedKeys(urls, listedKeys);
}
