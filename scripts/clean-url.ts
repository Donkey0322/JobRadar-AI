import { setMaxListeners } from "node:events";
import pLimit from "p-limit";

import { GREEN_CHECKMARK, RED_CROSS } from "@/constants/log";

import type { JDFetchResult, JDFetchStatus } from "@/modules/ats/detail";
import type { Opportunity } from "@/types";

import deduplicate, { syncExpiredFlags } from "./dedup";

import { classifyATS } from "@/modules/ats/core/classifier";
import { isTarget } from "@/modules/ats/core/filter";
import { HttpStatusCode, isRetryableJDFetch, NETWORK_ERROR_CODE } from "@/modules/ats/detail/fetch";
import { getRawJD } from "@/modules/job-analysis";
import {
  buildCompanyList,
  getCompanyKey,
  groupUrlsByCompanyKey,
} from "@/modules/job-discovery/company";
import { checkUrlsAgainstListing } from "@/modules/job-discovery/listing-liveness";
import {
  loadCompanies,
  loadOpportunities,
  loadUrls,
  saveOpportunities,
  saveUrls,
} from "@/utils/data";
import { renderProgress, startProgress } from "@/utils/dev";
import { groupUrlsByKey } from "@/utils/job-key";
import { logger } from "@/utils/logger";

// Node's fetch adds a `terminated` listener per redirect; Workday chains exceed the default of 10.
setMaxListeners(32);

const LISTING_OTHER_CONCURRENCY = 12;
const LISTING_WORKDAY_CONCURRENCY = 6;
const JD_OTHER_CONCURRENCY = 8;
const JD_WORKDAY_CONCURRENCY = 3;
const WORKDAY_HOST_CONCURRENCY = 1;
const WORKDAY_JD_GAP_MS = 100;
const MAX_RETRIES = 6;
const INITIAL_DELAY_MS = 2000;
const MAX_DELAY_MS = 60_000;
const FETCH_TIMEOUT_MS = 5 * 60 * 1000;
const LISTING_TIMEOUT_MS = 2 * 60 * 1000;

const listingOtherLimit = pLimit(LISTING_OTHER_CONCURRENCY);
const listingWorkdayLimit = pLimit(LISTING_WORKDAY_CONCURRENCY);
const jdOtherLimit = pLimit(JD_OTHER_CONCURRENCY);
const jdWorkdayLimit = pLimit(JD_WORKDAY_CONCURRENCY);
const workdayHostLimits = new Map<string, ReturnType<typeof pLimit>>();
const hostCooldownUntil = new Map<string, number>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getWorkdayHostLimit(host: string) {
  let limit = workdayHostLimits.get(host);
  if (!limit) {
    limit = pLimit(WORKDAY_HOST_CONCURRENCY);
    workdayHostLimits.set(host, limit);
  }
  return limit;
}

async function waitForHostCooldown(host: string) {
  const remaining = (hostCooldownUntil.get(host) ?? 0) - Date.now();
  if (remaining > 0) {
    await sleep(remaining);
  }
}

function extendHostCooldown(host: string, ms: number) {
  hostCooldownUntil.set(host, Math.max(hostCooldownUntil.get(host) ?? 0, Date.now() + ms));
}

function retryDelay(error: JDFetchStatus, delay: number) {
  return Math.min(MAX_DELAY_MS, Math.max(delay, error.retryAfterMs ?? 0));
}

async function getRawJDWithRetry(url: string, host: string): Promise<JDFetchResult> {
  let delay = INITIAL_DELAY_MS;
  let result = await getRawJD(url, AbortSignal.timeout(FETCH_TIMEOUT_MS));

  for (let attempt = 0; attempt < MAX_RETRIES && isRetryableJDFetch(result.error); attempt++) {
    const wait = retryDelay(result.error, delay);
    extendHostCooldown(host, wait);
    await sleep(wait + Math.floor(Math.random() * 250));
    result = await getRawJD(url, AbortSignal.timeout(FETCH_TIMEOUT_MS));
    delay *= 2;
  }

  return result;
}

function schedule<T>(url: string, kind: "listing" | "jd", fn: () => Promise<T>): Promise<T> {
  if (classifyATS(new URL(url)) !== "workday") {
    return (kind === "listing" ? listingOtherLimit : jdOtherLimit)(fn);
  }

  const host = new URL(url).hostname;
  const pool = kind === "listing" ? listingWorkdayLimit : jdWorkdayLimit;
  return getWorkdayHostLimit(host)(() =>
    pool(async () => {
      await waitForHostCooldown(host);
      const result = await fn();
      if (kind === "jd") {
        await sleep(WORKDAY_JD_GAP_MS);
      }
      return result;
    })
  );
}

async function main() {
  await deduplicate();
  const sent = await loadUrls();
  const urls = Array.from(sent);

  const untargetedOpportunities = new Set<string>();
  const targetedOpportunities: Opportunity[] = [];
  const jobs = await loadOpportunities();
  for (const job of jobs) {
    if (!isTarget(job.role)) {
      untargetedOpportunities.add(job.link);
    } else {
      targetedOpportunities.push(job);
    }
  }

  const urlsToCheck = urls.filter((url) => !untargetedOpportunities.has(url));
  const companiesByKey = new Map(
    (await loadCompanies()).map((company) => [getCompanyKey(company), company])
  );
  const groups = groupUrlsByCompanyKey(urlsToCheck);

  let completed = 0;
  let dropped = 0;
  let listed = 0;
  let rateLimited = 0;
  let networkFailed = 0;
  const total = urlsToCheck.length;
  const listedUrls: string[] = [];
  const unverifiedUrls: string[] = [];

  startProgress(total);

  await Promise.all(
    Array.from(groups.entries()).map(([key, groupUrls]) =>
      schedule(groupUrls[0], "listing", async () => {
        const company = companiesByKey.get(key);
        const result = company?.page
          ? await checkUrlsAgainstListing(
              company,
              groupUrls,
              AbortSignal.timeout(LISTING_TIMEOUT_MS)
            )
          : { listed: [], unverified: groupUrls };

        listedUrls.push(...result.listed);
        unverifiedUrls.push(...result.unverified);
        listed += result.listed.length;
        completed += result.listed.length;
        renderProgress(completed, total);
      })
    )
  );

  console.log(
    { listed, remaining: unverifiedUrls.length },
    `${GREEN_CHECKMARK} Listing pass finished`
  );

  const verifiedFromJd = (
    await Promise.all(
      unverifiedUrls.map((url) =>
        schedule(url, "jd", async () => {
          const host = new URL(url).hostname;
          const { error } = await getRawJDWithRetry(url, host);

          completed++;
          renderProgress(completed, total);

          if (HttpStatusCode.isError(error.code)) {
            dropped++;
            return null;
          }
          if (error.code === HttpStatusCode.TOO_MANY_REQUESTS) {
            rateLimited++;
            return url;
          }
          if (error.code === NETWORK_ERROR_CODE) {
            networkFailed++;
            return url;
          }
          if (!HttpStatusCode.isOk(error.code)) {
            console.error({ url, error }, `${RED_CROSS} Error fetching JD`);
          }
          return url;
        })
      )
    )
  ).filter((url): url is string => url !== null);

  const validUrls = [...listedUrls, ...verifiedFromJd];

  console.log(
    { validUrls: validUrls.length, listed, dropped, rateLimited, networkFailed },
    `${GREEN_CHECKMARK} Successfully cleaned urls`
  );

  await saveUrls(new Set(validUrls));
  await saveOpportunities(syncExpiredFlags(targetedOpportunities, groupUrlsByKey(validUrls)), true);

  return validUrls;
}

logger.level = "silent";
main()
  .then((urls) => buildCompanyList(urls))
  .catch((err) => {
    logger.fatal({ err }, `${RED_CROSS} Fatal error`);
    process.exit(1);
  });
