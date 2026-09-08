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
import { buildCompanyList } from "@/modules/job-discovery/company";
import { loadOpportunities, loadUrls, saveOpportunities, saveUrls } from "@/utils/data";
import { renderProgress, startProgress } from "@/utils/dev";
import { groupUrlsByKey } from "@/utils/job-key";
import { logger } from "@/utils/logger";

// Node's fetch adds a `terminated` listener per redirect; Workday chains exceed the default of 10.
setMaxListeners(32);

const OTHER_CONCURRENCY = 6;
const WORKDAY_CONCURRENCY = 2;
const WORKDAY_HOST_CONCURRENCY = 1;
const WORKDAY_GAP_MS = 300;
const MAX_RETRIES = 6;
const INITIAL_DELAY_MS = 2000;
const MAX_DELAY_MS = 60_000;
const FETCH_TIMEOUT_MS = 5 * 60 * 1000;

const otherLimit = pLimit(OTHER_CONCURRENCY);
const workdayLimit = pLimit(WORKDAY_CONCURRENCY);
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

function scheduleUrl<T>(url: string, fn: () => Promise<T>): Promise<T> {
  if (classifyATS(new URL(url)) !== "workday") {
    return otherLimit(fn);
  }

  const host = new URL(url).hostname;
  return getWorkdayHostLimit(host)(() =>
    workdayLimit(async () => {
      await waitForHostCooldown(host);
      const result = await fn();
      await sleep(WORKDAY_GAP_MS);
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

  let completed = 0;
  let dropped = 0;
  let rateLimited = 0;
  let networkFailed = 0;
  const total = urls.length;

  startProgress(total);

  const validUrls = (
    await Promise.all(
      urls.map((url) =>
        scheduleUrl(url, async () => {
          const host = new URL(url).hostname;
          const { error } = await getRawJDWithRetry(url, host);

          completed++;
          renderProgress(completed, total);

          if (untargetedOpportunities.has(url)) {
            return null;
          }

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

  console.log(
    { validUrls: validUrls.length, dropped, rateLimited, networkFailed },
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
