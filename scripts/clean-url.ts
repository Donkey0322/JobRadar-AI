import { setMaxListeners } from "node:events";
import pLimit from "p-limit";

import { GREEN_CHECKMARK, RED_CROSS } from "@/constants/log";

import type { JDFetchResult, JDFetchStatus } from "@/modules/posting/jd";
import type { Company, Opportunity } from "@/types";

import deduplicate from "./dedup";

import { buildCompanyList, getCompanyKey, groupUrlsByCompanyKey } from "@/modules/employer/build";
import { classifyATS } from "@/modules/employer/classifier";
import { checkUrlsAgainstListing } from "@/modules/employer/liveness";
import { Posting } from "@/modules/posting";
import { HttpStatusCode, isRetryableJDFetch, NETWORK_ERROR_CODE } from "@/modules/posting/jd";
import { syncExpiredFlags } from "@/modules/postings/dedup";
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

/**
 * Drop dead posting URLs from data/urls.json and refresh opportunity expiry.
 *
 * urls.json is the seen set. Discovery treats a posting as new when its URL is
 * missing, so a link is removed only after a check shows the posting is gone.
 *
 * 1. An employer listing page can confirm many URLs at once.
 * 2. URLs the listing did not confirm are checked by fetching the job description.
 *
 * A stored opportunity whose title no longer matches the target config stays in
 * urls.json and is not checked. Expiry uses only URLs that were checked, so an
 * unchecked link cannot keep a targeted opportunity alive.
 */

// Node's fetch adds a `terminated` listener per redirect; Workday chains exceed the default of 10.
setMaxListeners(32);

// Workday rejects bursts. Each host runs one request at a time, and a 429 pauses
// later requests to that host. Other boards share a wider pool.
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

type FetchKind = "listing" | "jd";

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

function retryDelay(status: JDFetchStatus, delay: number) {
  return Math.min(MAX_DELAY_MS, Math.max(delay, status.retryAfterMs ?? 0));
}

/** getRawJD only reads the link. The other posting fields are unused. */
function fetchRawJD(url: string, signal: AbortSignal): Promise<JDFetchResult> {
  return Posting.from({
    company: "",
    role: "",
    link: url,
    location: "",
  }).getRawJD(signal);
}

/**
 * Retry 429 and network errors with exponential backoff.
 * The wait is also applied to later requests for the same host.
 */
async function fetchRawJDWithRetry(url: string, host: string): Promise<JDFetchResult> {
  let delay = INITIAL_DELAY_MS;
  let result = await fetchRawJD(url, AbortSignal.timeout(FETCH_TIMEOUT_MS));

  for (let attempt = 0; attempt < MAX_RETRIES && isRetryableJDFetch(result.error); attempt++) {
    const wait = retryDelay(result.error, delay);
    extendHostCooldown(host, wait);
    await sleep(wait + Math.floor(Math.random() * 250));
    result = await fetchRawJD(url, AbortSignal.timeout(FETCH_TIMEOUT_MS));
    delay *= 2;
  }

  return result;
}

/** Run one fetch under the pool that matches its board. */
function runLimited<T>(url: string, kind: FetchKind, task: () => Promise<T>): Promise<T> {
  if (classifyATS(new URL(url)) !== "workday") {
    return (kind === "listing" ? listingOtherLimit : jdOtherLimit)(task);
  }

  const host = new URL(url).hostname;
  const pool = kind === "listing" ? listingWorkdayLimit : jdWorkdayLimit;
  return getWorkdayHostLimit(host)(() =>
    pool(async () => {
      await waitForHostCooldown(host);
      const result = await task();
      if (kind === "jd") {
        await sleep(WORKDAY_JD_GAP_MS);
      }
      return result;
    })
  );
}

interface CleanupPlan {
  /** Opportunities whose titles still match the target config. */
  targeted: Opportunity[];
  /** Seen URLs left in place because their opportunity is no longer a target. */
  skippedUrls: string[];
  /** Seen URLs that still need a liveness check. */
  urlsToCheck: string[];
}

function planCleanup(urls: readonly string[], opportunities: readonly Opportunity[]): CleanupPlan {
  const untargetedLinks = new Set<string>();
  const targeted: Opportunity[] = [];

  for (const opportunity of opportunities) {
    if (Posting.from(opportunity).isTarget()) {
      targeted.push(opportunity);
    } else {
      untargetedLinks.add(opportunity.link);
    }
  }

  const skippedUrls: string[] = [];
  const urlsToCheck: string[] = [];

  for (const url of urls) {
    if (untargetedLinks.has(url)) {
      skippedUrls.push(url);
    } else {
      urlsToCheck.push(url);
    }
  }

  return { targeted, skippedUrls, urlsToCheck };
}

function trackProgress(total: number) {
  let completed = 0;
  startProgress(total);

  return (count: number) => {
    completed += count;
    renderProgress(completed, total);
  };
}

interface ListingPass {
  listedUrls: string[];
  unverifiedUrls: string[];
}

/**
 * Ask each employer's listing page which of our URLs are still posted.
 * Boards without a listing page leave every URL for the JD pass.
 */
async function confirmOnListings(
  urls: string[],
  companiesByKey: ReadonlyMap<string, Company>,
  advance: (count: number) => void
): Promise<ListingPass> {
  const listedUrls: string[] = [];
  const unverifiedUrls: string[] = [];
  const urlsByCompany = groupUrlsByCompanyKey(urls);

  await Promise.all(
    Array.from(urlsByCompany.entries()).map(([companyKey, companyUrls]) =>
      // The first URL picks the concurrency pool for the whole company.
      runLimited(companyUrls[0], "listing", async () => {
        const company = companiesByKey.get(companyKey);
        const result = company?.page
          ? await checkUrlsAgainstListing(
              company,
              companyUrls,
              AbortSignal.timeout(LISTING_TIMEOUT_MS)
            )
          : { listed: [], unverified: [...companyUrls] };

        listedUrls.push(...result.listed);
        unverifiedUrls.push(...result.unverified);
        advance(result.listed.length);
      })
    )
  );

  return { listedUrls, unverifiedUrls };
}

type JdOutcome = "live" | "dropped" | "rate-limited" | "network-failed" | "unexpected";

/**
 * A 429 or a network failure is not evidence the posting is gone, so those URLs stay.
 * Any other HTTP error removes the URL.
 */
function classifyJdFetch(status: JDFetchStatus): JdOutcome {
  if (HttpStatusCode.isError(status.code)) {
    return "dropped";
  }
  if (status.code === HttpStatusCode.TOO_MANY_REQUESTS) {
    return "rate-limited";
  }
  if (status.code === NETWORK_ERROR_CODE) {
    return "network-failed";
  }
  if (!HttpStatusCode.isOk(status.code)) {
    return "unexpected";
  }
  return "live";
}

interface JdPass {
  keptUrls: string[];
  dropped: number;
  rateLimited: number;
  networkFailed: number;
}

async function confirmByJobDescription(
  urls: readonly string[],
  advance: (count: number) => void
): Promise<JdPass> {
  let dropped = 0;
  let rateLimited = 0;
  let networkFailed = 0;

  const keptUrls = (
    await Promise.all(
      urls.map((url) =>
        runLimited(url, "jd", async () => {
          const host = new URL(url).hostname;
          const { error } = await fetchRawJDWithRetry(url, host);
          advance(1);

          switch (classifyJdFetch(error)) {
            case "dropped":
              dropped++;
              return null;
            case "rate-limited":
              rateLimited++;
              return url;
            case "network-failed":
              networkFailed++;
              return url;
            case "unexpected":
              console.error({ url, error }, `${RED_CROSS} Error fetching JD`);
              return url;
            case "live":
              return url;
          }
        })
      )
    )
  ).filter((url): url is string => url !== null);

  return { keptUrls, dropped, rateLimited, networkFailed };
}

async function main() {
  await deduplicate();

  const storedUrls = Array.from(await loadUrls());
  const opportunities = await loadOpportunities();
  const { targeted, skippedUrls, urlsToCheck } = planCleanup(storedUrls, opportunities);
  const companiesByKey = new Map(
    (await loadCompanies()).map((company) => [getCompanyKey(company), company])
  );

  const advance = trackProgress(urlsToCheck.length);
  const { listedUrls, unverifiedUrls } = await confirmOnListings(
    urlsToCheck,
    companiesByKey,
    advance
  );

  console.log(
    { listed: listedUrls.length, remaining: unverifiedUrls.length },
    `${GREEN_CHECKMARK} Listing pass finished`
  );

  const jd = await confirmByJobDescription(unverifiedUrls, advance);
  const checkedUrls = [...listedUrls, ...jd.keptUrls];
  const urlsToSave = [...checkedUrls, ...skippedUrls];

  console.log(
    {
      validUrls: urlsToSave.length,
      listed: listedUrls.length,
      dropped: jd.dropped,
      rateLimited: jd.rateLimited,
      networkFailed: jd.networkFailed,
      skipped: skippedUrls.length,
    },
    `${GREEN_CHECKMARK} Successfully cleaned urls`
  );

  await saveUrls(new Set(urlsToSave));
  await saveOpportunities(syncExpiredFlags(targeted, groupUrlsByKey(checkedUrls)), true);

  return urlsToSave;
}

logger.level = "silent";
main()
  .then((urls) => buildCompanyList(urls))
  .catch((err) => {
    logger.fatal({ err }, `${RED_CROSS} Fatal error`);
    process.exit(1);
  });
