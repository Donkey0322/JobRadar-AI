import { setMaxListeners } from "node:events";
import pLimit from "p-limit";

import { GREEN_CHECKMARK, RED_CROSS } from "@/constants/log";

import type { JDFetchResult, JDFetchStatus } from "@/modules/posting/jd";
import type { Company, Opportunity } from "@/types";

import { recordStage } from "../../github/summary";
import { renderBuildProgress } from "../../utils/progress";

import { dedupeStored as deduplicate } from "./dedup";

import { classifyATS } from "@/modules/ats/classify";
import { groupUrlsByKey } from "@/modules/ats/job-key";
import { buildCompanyList, companyKey, groupUrlsByCompanyKey } from "@/modules/employer/build";
import { checkUrlsAgainstListing } from "@/modules/employer/liveness";
import { dropStaleExpiredOpportunities, syncExpiredFlags } from "@/modules/opportunity/dedup";
import { Posting } from "@/modules/posting";
import {
  HttpStatusCode,
  isRetryableJDFetch,
  JD_FETCH_ERROR,
  NETWORK_ERROR_CODE,
} from "@/modules/posting/jd";
import {
  greenhouseSlugRequestCount,
  runWithGreenhouseSlugCache,
} from "@/modules/posting/jd/greenhouse";
import * as store from "@/store";
import { logger } from "@/utils/logger";

/**
 * Drop dead posting URLs from data/urls.json and refresh opportunity expiry.
 *
 * urls.json is the seen set. Discovery treats a posting as new when its URL is
 * missing, so a link is removed only after a check shows the posting is gone.
 *
 * 1. An employer listing page can confirm many URLs at once. Each company hands
 *    its unconfirmed URLs to the JD pool as soon as that listing finishes.
 * 2. URLs the listing did not confirm are checked by fetching the job description.
 *    Permission errors, rate limits, server errors, timeouts, and synthetic
 *    "no data" results keep the URL. Only a final HTTP 404 or 410 from the
 *    posting itself removes it.
 *
 * Every stored URL is checked, including ones whose opportunity title no longer
 * matches the target config. That mismatch does not remove the URL. Expiry is
 * updated only for opportunities that still match. Expired rows last seen more
 * than 90 days ago are removed; active rows stay regardless of age.
 */

// Node's fetch adds a `terminated` listener per redirect; Workday chains exceed the default of 10.
setMaxListeners(32);

// Workday rejects bursts. Each host runs one request at a time, and a 429 pauses
// later requests to that host. Other boards share eight JD slots. A non-Workday
// retry frees its slot before the backoff, then queues the next attempt again.
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
/** Non-TTY runs log on this interval. The line has no mixed-cost ETA. */
const CLEAN_PROGRESS_INTERVAL_MS = 30_000;
const SYNTHETIC_NOT_FOUND = JD_FETCH_ERROR.noData().desc;

type FetchKind = "listing" | "jd";

const listingOtherLimit = pLimit(LISTING_OTHER_CONCURRENCY);
const listingWorkdayLimit = pLimit(LISTING_WORKDAY_CONCURRENCY);
const jdOtherLimit = pLimit(JD_OTHER_CONCURRENCY);
const jdWorkdayLimit = pLimit(JD_WORKDAY_CONCURRENCY);
const workdayHostLimits = new Map<string, ReturnType<typeof pLimit>>();
const hostCooldownUntil = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Runtime {
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  random: () => number;
}

function getWorkdayHostLimit(host: string) {
  let limit = workdayHostLimits.get(host);
  if (!limit) {
    limit = pLimit(WORKDAY_HOST_CONCURRENCY);
    workdayHostLimits.set(host, limit);
  }
  return limit;
}

async function waitForHostCooldown(host: string, runtime: Runtime) {
  const remaining = (hostCooldownUntil.get(host) ?? 0) - runtime.now();
  if (remaining > 0) {
    await runtime.sleep(remaining);
  }
}

function extendHostCooldown(host: string, ms: number, runtime: Runtime) {
  hostCooldownUntil.set(host, Math.max(hostCooldownUntil.get(host) ?? 0, runtime.now() + ms));
}

function retryDelay(status: JDFetchStatus, delay: number) {
  return Math.min(MAX_DELAY_MS, Math.max(delay, status.retryAfterMs ?? 0));
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "invalid";
  }
}

function isWorkdayUrl(url: string): boolean {
  try {
    return classifyATS(new URL(url)) === "workday";
  } catch {
    return false;
  }
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

interface TimeSink {
  add(part: "queueMs" | "busyMs" | "backoffMs", ms: number): void;
}

/**
 * Run one fetch under the pool that matches its board. The slot is free when this promise settles.
 * Queue time is the wait for a pool slot. Host cooldown and the Workday JD gap are backoff, not busy time.
 * Non-Workday JD calls this once per attempt and waits for its retry outside the pool.
 */
function runLimited<T>(
  url: string,
  kind: FetchKind,
  task: () => Promise<T>,
  runtime: Runtime,
  sink: TimeSink
): Promise<T> {
  const queuedAt = runtime.now();
  const markQueue = () => {
    sink.add("queueMs", Math.max(0, runtime.now() - queuedAt));
  };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    markQueue();
    return task();
  }

  const workday = classifyATS(parsed) === "workday";
  const host = parsed.hostname;

  if (!workday) {
    return (kind === "listing" ? listingOtherLimit : jdOtherLimit)(async () => {
      markQueue();
      return task();
    });
  }

  const pool = kind === "listing" ? listingWorkdayLimit : jdWorkdayLimit;
  return getWorkdayHostLimit(host)(() =>
    pool(async () => {
      markQueue();
      const coolStart = runtime.now();
      await waitForHostCooldown(host, runtime);
      sink.add("backoffMs", Math.max(0, runtime.now() - coolStart));
      const result = await task();
      if (kind === "jd") {
        const gapStart = runtime.now();
        await runtime.sleep(WORKDAY_JD_GAP_MS);
        sink.add("backoffMs", Math.max(0, runtime.now() - gapStart));
      }
      return result;
    })
  );
}

/** Opportunities whose titles still match the target config. The rest are not written back. */
function targetedOpportunities(opportunities: readonly Opportunity[]): Opportunity[] {
  return opportunities.filter((opportunity) => Posting.from(opportunity).isTarget());
}

export type JdLiveness = "live" | "gone" | "unknown";

/**
 * The status is the final getRawJD result, after HTML fallback.
 * HTTP 404 and 410 remove a URL only when they are that response's own status.
 * `noData` is a synthetic 404 (empty body, soft-closed page, or a redirect off
 * the job) and stays. Permission blocks, 429, 5xx, network errors, timeouts,
 * unparseable URLs, and other 4xx such as an ATS 422 stay as well.
 */
export function classifyJdFetch(status: JDFetchStatus): JdLiveness {
  if (status.code >= 200 && status.code < 300) return "live";

  const explicitRemoval =
    (status.code === HttpStatusCode.NOT_FOUND || status.code === HttpStatusCode.GONE) &&
    status.desc !== SYNTHETIC_NOT_FOUND;

  return explicitRemoval ? "gone" : "unknown";
}

/**
 * Bucket a kept unknown from structured status fields.
 * A timeout message with no `failure` tag stays a network error. An unmatched status is `other`.
 */
export function unknownReason(status: JDFetchStatus): UnknownReason {
  if (status.code === HttpStatusCode.TOO_MANY_REQUESTS) return "429";
  if (status.code === HttpStatusCode.REQUEST_TIMEOUT || status.failure === "timeout") return "timeout";
  if (status.failure === "closed" || status.failure === "invalid") return "closed-or-unparsed";
  if (status.code === NETWORK_ERROR_CODE) return "network";
  if (status.code === HttpStatusCode.UNAUTHORIZED || status.code === HttpStatusCode.FORBIDDEN) {
    return "401/403";
  }
  if (status.code >= 500 && status.code < 600) return "5xx";
  if (status.code === HttpStatusCode.NOT_FOUND && status.desc === SYNTHETIC_NOT_FOUND) {
    return "closed-or-unparsed";
  }
  return "other";
}

function blankPhase(): CleanPhaseTime {
  return { queueMs: 0, busyMs: 0, backoffMs: 0 };
}

function blankReasons(): CleanUnknownReasons {
  return {
    "429": 0,
    timeout: 0,
    network: 0,
    "401/403": 0,
    "5xx": 0,
    "closed-or-unparsed": 0,
    other: 0,
  };
}

function atsOf(url: string): string {
  try {
    return classifyATS(new URL(url));
  } catch {
    return "none";
  }
}

export interface CleanProgress {
  completed: number;
  total: number;
  companiesDone: number;
  companiesTotal: number;
  /** Queued for a JD slot, including a non-Workday attempt that is ready to run again. */
  jdPending: number;
  /** Inside `fetchJd`. For Workday this also covers the in-slot retry wait. */
  jdActive: number;
  /** Non-Workday URLs waiting out a retry with the slot released. */
  jdBackoff: number;
  retries: number;
  unknown: number;
  elapsedMs: number;
}

export interface CleanReport {
  urls: string[];
  dropped: string[];
  elapsedMs: number;
  /**
   * Listing pages reported by the default one-request collector and by Workday,
   * Eightfold, Phenom, and Apple. Other board overrides do not report each page.
   */
  listingPages: number;
  listingHits: number;
  /**
   * Calls into fetchJd, including retries. Not a total HTTP count: one attempt
   * can still request the ATS API and then the HTML fallback.
   */
  jdAttempts: number;
  retries: number;
  unknown: number;
  slugRequests: number;
  byAts: CleanAtsStats[];
  unknownReasons: CleanUnknownReasons;
  slowestCompanies: CleanSlowSource[];
  slowestHosts: CleanSlowSource[];
  /** Sums of parallel work are not wall-clock `elapsedMs`. */
  timingNote: string;
  /** Which ATS and host each count uses. */
  attribution: string;
}

export interface CleanPhaseTime {
  queueMs: number;
  busyMs: number;
  backoffMs: number;
}

export interface CleanAtsStats {
  ats: string;
  urls: number;
  listingHits: number;
  jdAttempts: number;
  retries: number;
  unknown: number;
  listing: CleanPhaseTime;
  jd: CleanPhaseTime;
}

export const UNKNOWN_REASONS = [
  "429",
  "timeout",
  "network",
  "401/403",
  "5xx",
  "closed-or-unparsed",
  "other",
] as const;

export type UnknownReason = (typeof UNKNOWN_REASONS)[number];

export type CleanUnknownReasons = Record<UnknownReason, number>;

export interface CleanSlowSource {
  company?: string;
  host: string;
  /** queueMs + busyMs + backoffMs. This is accumulated parallel time, not wall-clock elapsed. */
  accumulatedMs: number;
  queueMs: number;
  busyMs: number;
  backoffMs: number;
  retries: number;
  unknown: number;
}

const PARALLEL_TIME_NOTE =
  "queueMs, busyMs, and backoffMs sum parallel work. They are not wall-clock elapsedMs.";
const ATTRIBUTION_NOTE =
  "urls, listingHits, jdAttempts, retries, and unknown follow the stored URL. listing queueMs, busyMs, and backoffMs follow company.ats and the hostname of company.page. jd queueMs, busyMs, and backoffMs follow the stored URL.";
const SLOWEST_LIMIT = 10;

export interface CleanHooks {
  checkListing?: typeof checkUrlsAgainstListing;
  fetchJd?: (url: string, signal: AbortSignal) => Promise<JDFetchResult>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  onProgress?: (progress: CleanProgress) => void;
  listingTimeoutMs?: number;
  fetchTimeoutMs?: number;
}

function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
}

/** Counts and elapsed only. Listing and JD have different costs, so this line has no ETA. */
export function formatCleanStatus(progress: CleanProgress): string {
  return [
    `clean ${progress.completed}/${progress.total}`,
    `companies ${progress.companiesDone}/${progress.companiesTotal}`,
    `jd waiting ${progress.jdPending}`,
    `active ${progress.jdActive}`,
    `backoff ${progress.jdBackoff}`,
    `retries ${progress.retries}`,
    `unknown ${progress.unknown}`,
    formatElapsed(progress.elapsedMs),
  ].join(" ");
}

interface ResolvedHooks {
  checkListing: typeof checkUrlsAgainstListing;
  fetchJd: (url: string, signal: AbortSignal) => Promise<JDFetchResult>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  random: () => number;
  onProgress?: (progress: CleanProgress) => void;
  listingTimeoutMs: number;
  fetchTimeoutMs: number;
}

async function runCleanBody(
  urls: readonly string[],
  companies: readonly Company[],
  hooks: ResolvedHooks
): Promise<CleanReport> {
  hostCooldownUntil.clear();

  const unique = [...new Set(urls)];
  const input = new Set(unique);
  const companiesByKey = new Map(companies.map((company) => [companyKey(company), company]));
  const urlsByCompany = groupUrlsByCompanyKey(unique);
  const runtime: Runtime = { sleep: hooks.sleep, now: hooks.now, random: hooks.random };
  const started = hooks.now();

  const dropped = new Set<string>();
  const finished = new Set<string>();
  let completed = 0;
  let companiesDone = 0;
  let jdPending = 0;
  let jdActive = 0;
  let jdBackoff = 0;
  let retries = 0;
  let unknown = 0;
  let listingHits = 0;
  let listingPages = 0;
  let jdAttempts = 0;
  const companiesTotal = urlsByCompany.size;
  const reasons = blankReasons();

  interface AtsMutable extends Omit<CleanAtsStats, "ats" | "listing" | "jd"> {
    listing: CleanPhaseTime;
    jd: CleanPhaseTime;
  }
  interface SourceMutable {
    label: string;
    hosts: Set<string>;
    queueMs: number;
    busyMs: number;
    backoffMs: number;
    retries: number;
    unknown: number;
  }

  const atsRows = new Map<string, AtsMutable>();
  const companyRows = new Map<string, SourceMutable>();
  const hostRows = new Map<string, SourceMutable>();

  const atsRow = (ats: string): AtsMutable => {
    let row = atsRows.get(ats);
    if (!row) {
      row = {
        urls: 0,
        listingHits: 0,
        jdAttempts: 0,
        retries: 0,
        unknown: 0,
        listing: blankPhase(),
        jd: blankPhase(),
      };
      atsRows.set(ats, row);
    }
    return row;
  };

  const sourceRow = (rows: Map<string, SourceMutable>, key: string, label: string): SourceMutable => {
    let row = rows.get(key);
    if (!row) {
      row = { label, hosts: new Set(), queueMs: 0, busyMs: 0, backoffMs: 0, retries: 0, unknown: 0 };
      rows.set(key, row);
    }
    return row;
  };

  const companyLabel = (key: string): string => {
    const company = companiesByKey.get(key);
    return company?.name ? `${company.name} (${key})` : key;
  };

  const touch = (url: string, key: string) => {
    const host = hostnameOf(url);
    const company = sourceRow(companyRows, key, companyLabel(key));
    company.hosts.add(host);
    return { ats: atsOf(url), host, company, hostRow: sourceRow(hostRows, host, host) };
  };

  for (const url of unique) {
    atsRow(atsOf(url)).urls++;
  }

  const addTime = (kind: FetchKind, part: keyof CleanPhaseTime, ms: number, url: string, key: string) => {
    if (!(ms > 0)) return;
    const noted = touch(url, key);
    atsRow(noted.ats)[kind][part] += ms;
    noted.company[part] += ms;
    noted.hostRow[part] += ms;
  };

  const addListingTime = (company: Company, key: string, part: keyof CleanPhaseTime, ms: number) => {
    if (!(ms > 0)) return;
    const host = hostnameOf(company.page);
    atsRow(company.ats).listing[part] += ms;
    const row = sourceRow(companyRows, key, companyLabel(key));
    row.hosts.add(host);
    row[part] += ms;
    sourceRow(hostRows, host, host)[part] += ms;
  };

  const listingSink = (company: Company, key: string): TimeSink => ({
    add(part, ms) {
      addListingTime(company, key, part, ms);
    },
  });

  const sinkFor = (kind: FetchKind, url: string, key: string): TimeSink => ({
    add(part, ms) {
      addTime(kind, part, ms, url, key);
    },
  });

  const countRetry = (url: string, key: string) => {
    retries++;
    const noted = touch(url, key);
    atsRow(noted.ats).retries++;
    noted.company.retries++;
    noted.hostRow.retries++;
  };

  const countUnknown = (url: string, key: string, reason: UnknownReason) => {
    unknown++;
    const noted = touch(url, key);
    atsRow(noted.ats).unknown++;
    noted.company.unknown++;
    noted.hostRow.unknown++;
    reasons[reason]++;
  };

  const progress = (): CleanProgress => ({
    completed,
    total: unique.length,
    companiesDone,
    companiesTotal,
    jdPending,
    jdActive,
    jdBackoff,
    retries,
    unknown,
    elapsedMs: hooks.now() - started,
  });

  const emit = (event: "company" | "url" | "done") => {
    const current = progress();
    hooks.onProgress?.(current);
    if (process.stdout.isTTY) {
      process.stdout.write(`\r${formatCleanStatus(current)}   `);
      if (event === "done") process.stdout.write("\n");
      return;
    }
    if (event === "done") console.log(formatCleanStatus(current));
  };

  const stopProgress = startNonTtyProgress(() => {
    console.log(formatCleanStatus(progress()));
  });

  const finish = (url: string) => {
    if (!input.has(url) || finished.has(url)) return;
    finished.add(url);
    completed++;
    emit("url");
  };

  const fetchAttempt = async (url: string, sink: TimeSink): Promise<JDFetchResult> => {
    jdAttempts++;
    atsRow(atsOf(url)).jdAttempts++;
    const busyStart = runtime.now();
    try {
      return await hooks.fetchJd(url, AbortSignal.timeout(hooks.fetchTimeoutMs));
    } finally {
      sink.add("busyMs", Math.max(0, runtime.now() - busyStart));
    }
  };

  const waitToRetry = async (
    url: string,
    key: string,
    status: JDFetchStatus,
    delay: number,
    sink: TimeSink
  ): Promise<number> => {
    countRetry(url, key);
    emit("url");
    const wait = retryDelay(status, delay);
    extendHostCooldown(hostnameOf(url), wait, runtime);
    const backoffStart = runtime.now();
    await runtime.sleep(wait + Math.floor(runtime.random() * 250));
    sink.add("backoffMs", Math.max(0, runtime.now() - backoffStart));
    return delay * 2;
  };

  const applyOutcome = (url: string, key: string, error: JDFetchStatus) => {
    const outcome = classifyJdFetch(error);
    if (outcome === "gone") dropped.add(url);
    else if (outcome === "unknown") countUnknown(url, key, unknownReason(error));
  };

  const failJd = (url: string, key: string, error: unknown) => {
    countUnknown(url, key, "other");
    console.error({ url, err: error }, `${RED_CROSS} Error fetching JD`);
  };

  /** Workday keeps the host slot through the retry wait and the JD gap. */
  const fetchWithRetry = async (url: string, key: string, sink: TimeSink): Promise<JDFetchResult> => {
    let delay = INITIAL_DELAY_MS;
    let result = await fetchAttempt(url, sink);
    for (let attemptNumber = 0; attemptNumber < MAX_RETRIES && isRetryableJDFetch(result.error); attemptNumber++) {
      delay = await waitToRetry(url, key, result.error, delay, sink);
      result = await fetchAttempt(url, sink);
    }
    return result;
  };

  const confirmJd = async (url: string, key: string, sink: TimeSink): Promise<void> => {
    jdPending = Math.max(0, jdPending - 1);
    jdActive++;
    emit("url");
    try {
      const { error } = await fetchWithRetry(url, key, sink);
      applyOutcome(url, key, error);
    } catch (error) {
      failJd(url, key, error);
    } finally {
      jdActive = Math.max(0, jdActive - 1);
      finish(url);
    }
  };

  /**
   * The pool wraps one fetch. A retryable result leaves the slot, waits, then queues again.
   * The URL stays unfinished until that later attempt returns a final result.
   */
  const confirmOtherJd = async (url: string, key: string, sink: TimeSink): Promise<void> => {
    let delay = INITIAL_DELAY_MS;
    try {
      for (let attemptNumber = 0; ; attemptNumber++) {
        const result = await runLimited(
          url,
          "jd",
          async () => {
            jdPending = Math.max(0, jdPending - 1);
            jdActive++;
            emit("url");
            try {
              return await fetchAttempt(url, sink);
            } finally {
              jdActive = Math.max(0, jdActive - 1);
            }
          },
          runtime,
          sink
        );

        if (attemptNumber >= MAX_RETRIES || !isRetryableJDFetch(result.error)) {
          applyOutcome(url, key, result.error);
          return;
        }

        jdBackoff++;
        try {
          delay = await waitToRetry(url, key, result.error, delay, sink);
        } finally {
          jdBackoff = Math.max(0, jdBackoff - 1);
        }
        jdPending++;
        emit("url");
      }
    } catch (error) {
      failJd(url, key, error);
    } finally {
      finish(url);
    }
  };

  const queueJd = (key: string, companyUrls: readonly string[], jdTasks: Promise<void>[]) => {
    const pending = companyUrls.filter((url) => input.has(url) && !finished.has(url));
    if (pending.length === 0) return;

    jdPending += pending.length;
    emit("url");
    for (const url of pending) {
      const sink = sinkFor("jd", url, key);
      jdTasks.push(
        isWorkdayUrl(url)
          ? runLimited(url, "jd", () => confirmJd(url, key, sink), runtime, sink)
          : confirmOtherJd(url, key, sink)
      );
    }
  };

  const jdTasks: Promise<void>[] = [];

  try {
    await Promise.all(
      Array.from(urlsByCompany.entries()).map(async ([key, companyUrls]) => {
        const first = companyUrls[0];
        let result: { listed: string[]; unverified: string[] } = {
          listed: [],
          unverified: [...companyUrls],
        };

        try {
          if (first) {
            const company = companiesByKey.get(key);
            // The stored URL still selects the pool and host lock. Listing time follows the board that runs.
            const sink: TimeSink = company?.page
              ? listingSink(company, key)
              : { add() {} };
            result = await runLimited(
              first,
              "listing",
              async () => {
                if (!company?.page) return { listed: [], unverified: [...companyUrls] };
                const busyStart = runtime.now();
                try {
                  return await hooks.checkListing(
                    company,
                    companyUrls,
                    AbortSignal.timeout(hooks.listingTimeoutMs),
                    {
                      onPage: () => {
                        listingPages++;
                      },
                    }
                  );
                } finally {
                  sink.add("busyMs", Math.max(0, runtime.now() - busyStart));
                }
              },
              runtime,
              sink
            );
          }
        } catch (error) {
          console.error({ companyKey: key, err: error }, `${RED_CROSS} Error fetching listing`);
          result = { listed: [], unverified: [...companyUrls] };
        }

        for (const url of result.listed) {
          if (!input.has(url) || finished.has(url)) continue;
          listingHits++;
          atsRow(atsOf(url)).listingHits++;
          finish(url);
        }

        companiesDone++;
        queueJd(key, result.unverified, jdTasks);
        emit("company");
      })
    );

    await Promise.all(jdTasks);

    for (const url of unique) {
      if (!finished.has(url) && !dropped.has(url)) finish(url);
    }

    emit("done");

    const kept = unique.filter((url) => !dropped.has(url));
    const rank = (rows: Iterable<SourceMutable>, includeCompany: boolean): CleanSlowSource[] =>
      [...rows]
        .map((row) => ({
          ...(includeCompany ? { company: row.label, host: [...row.hosts].sort().join(",") } : { host: row.label }),
          accumulatedMs: row.queueMs + row.busyMs + row.backoffMs,
          queueMs: row.queueMs,
          busyMs: row.busyMs,
          backoffMs: row.backoffMs,
          retries: row.retries,
          unknown: row.unknown,
        }))
        .filter((row) => row.accumulatedMs > 0 || row.retries > 0 || row.unknown > 0)
        .sort((a, b) => {
          const nameA = "company" in a ? a.company : a.host;
          const nameB = "company" in b ? b.company : b.host;
          return b.accumulatedMs - a.accumulatedMs || b.busyMs - a.busyMs || nameA.localeCompare(nameB);
        })
        .slice(0, SLOWEST_LIMIT);

    const report: CleanReport = {
      urls: kept,
      dropped: unique.filter((url) => dropped.has(url)),
      elapsedMs: hooks.now() - started,
      listingPages,
      listingHits,
      jdAttempts,
      retries,
      unknown,
      slugRequests: greenhouseSlugRequestCount(),
      byAts: [...atsRows.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([ats, row]) => ({ ats, ...row })),
      unknownReasons: reasons,
      slowestCompanies: rank(companyRows.values(), true),
      slowestHosts: rank(hostRows.values(), false),
      timingNote: PARALLEL_TIME_NOTE,
      attribution: ATTRIBUTION_NOTE,
    };

    console.log(
      `${GREEN_CHECKMARK} Clean measured\n${JSON.stringify(
        {
          elapsedMs: report.elapsedMs,
          listingPages: report.listingPages,
          listingHits: report.listingHits,
          jdAttempts: report.jdAttempts,
          retries: report.retries,
          unknown: report.unknown,
          dropped: report.dropped.length,
          kept: report.urls.length,
          slugRequests: report.slugRequests,
          byAts: report.byAts,
          unknownReasons: report.unknownReasons,
          slowestCompanies: report.slowestCompanies,
          slowestHosts: report.slowestHosts,
          timingNote: report.timingNote,
          attribution: report.attribution,
        },
        null,
        2
      )}`
    );

    return report;
  } finally {
    stopProgress();
  }
}

/** Log the current counts on a fixed interval. Cleared when the run settles. */
function startNonTtyProgress(log: () => void): () => void {
  if (process.stdout.isTTY) return () => {};

  const timer = setInterval(log, CLEAN_PROGRESS_INTERVAL_MS);
  if (typeof timer === "object" && timer !== null && "unref" in timer) timer.unref();
  return () => clearInterval(timer);
}

export async function runClean(input: {
  urls: readonly string[];
  companies: readonly Company[];
  hooks?: CleanHooks;
}): Promise<CleanReport> {
  return runWithGreenhouseSlugCache(() =>
    runCleanBody(input.urls, input.companies, {
      checkListing: input.hooks?.checkListing ?? checkUrlsAgainstListing,
      fetchJd: input.hooks?.fetchJd ?? fetchRawJD,
      sleep: input.hooks?.sleep ?? sleep,
      now: input.hooks?.now ?? Date.now,
      random: input.hooks?.random ?? Math.random,
      onProgress: input.hooks?.onProgress,
      listingTimeoutMs: input.hooks?.listingTimeoutMs ?? LISTING_TIMEOUT_MS,
      fetchTimeoutMs: input.hooks?.fetchTimeoutMs ?? FETCH_TIMEOUT_MS,
    })
  );
}

async function main() {
  try {
    await deduplicate();

    const storedUrls = Array.from(await store.urls.load());
    const targeted = targetedOpportunities(await store.opportunities.load());
    const companies = await store.companies.load();
    const report = await runClean({ urls: storedUrls, companies });

    await store.urls.save(new Set(report.urls));

    const synced = syncExpiredFlags(targeted, groupUrlsByKey(report.urls));
    const opportunities = dropStaleExpiredOpportunities(synced);

    console.log(
      { opportunities: opportunities.length, staleExpired: synced.length - opportunities.length },
      `${GREEN_CHECKMARK} Pruned stale expired opportunities`
    );

    await store.opportunities.replace(opportunities);
    recordStage({
      stage: "maintenance",
      task: "clean",
      status: "success",
      kept: report.urls.length,
      dropped: report.dropped.length,
      unknown: report.unknown,
      retries: report.retries,
      elapsedMs: report.elapsedMs,
      saved: "complete",
    });

    return report.urls;
  } catch (error) {
    recordStage({
      stage: "maintenance",
      task: "clean",
      status: "failed",
      reason: "clean failed",
      saved: "unknown",
    });
    throw error;
  }
}

export async function cleanUrls() {
  logger.level = "silent";
  const urls = await main();
  await buildCompanyList(urls, renderBuildProgress);
  return urls;
}
