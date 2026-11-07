import pLimit from "p-limit";

import { RED_CROSS } from "@/constants/log";

import type { JobOutcome, SkipKind } from "./outcome";
import type { OpportunityLedger } from "@/modules/opportunity/seen";
import type { PostingAnalysisFailure } from "@/modules/posting";
import type { Job } from "@/types";
import type { JD } from "@/types/jobs";

import { renderBuildProgress, renderProgress, startProgress } from "../utils/progress";

import { outcomeAfterAnalysis, resolveJob } from "./outcome";

import { deduplicateJobs, getJobKey, groupUrlsByKey } from "@/modules/ats/job-key";
import { buildCompanyList } from "@/modules/employer/build";
import {
  createOpportunityLedger,
  recordSeenOpportunity,
  seenOpportunitiesToWrite,
} from "@/modules/opportunity/seen";
import { Posting } from "@/modules/posting";
import { parseStoredJD } from "@/modules/posting/analysis/validation/ai";
import { enqueueBatchJobs } from "@/modules/posting/batch";
import * as store from "@/store";
import { logger } from "@/utils/logger";

const DEFAULT_SOFT_DEADLINE_MS = 15 * 60 * 1000;
const MIN_TIME_TO_START_JOB_MS = 60 * 1000;
const AI_CONCURRENCY = 5;

export async function createSyncContext() {
  const urls = await store.urls.load();
  const keys = new Set(groupUrlsByKey(Array.from(urls)).keys());

  const sentJobs = await store.jobs.load();
  const currentId = sentJobs.find((job) => job.id)?.id ?? 0;

  return {
    urls,
    keys,
    currentId,
  };
}

interface ProcessJobsOptions {
  jobs: Job[];

  urls: Set<string>;
  keys: Set<string>;

  currentId: number;

  /**
   * Filter out jobs that don't match the criteria.
   *
   * Return true to skip the job.
   */
  filter?: (job: Job) => Promise<boolean> | boolean;

  /**
   * Soft deadline for this function.
   *
   * GitHub Actions hard timeout should be longer than this.
   * Example:
   * soft deadline: 10 minutes
   * GitHub timeout-minutes: 15
   */
  softDeadlineMs?: number;
}

interface ApplyState {
  currentId: number;
  jobs: Job[];
  batchedJobs: Job[];
  totalCost: number;
  skipped: number;
  failed: number;
  batched: number;
  notStarted: number;
  skipReasons: Partial<Record<SkipKind, number>>;
  forceStopped: boolean;
  markAsSeen: (posting: Posting) => void;
}

function createApplyState(currentId: number, markAsSeen: (posting: Posting) => void): ApplyState {
  return {
    currentId,
    jobs: [],
    batchedJobs: [],
    totalCost: 0,
    skipped: 0,
    failed: 0,
    batched: 0,
    notStarted: 0,
    skipReasons: {},
    forceStopped: false,
    markAsSeen,
  };
}

async function saveSeenOpportunities(ledger: OpportunityLedger) {
  const write = seenOpportunitiesToWrite(ledger);

  if (!write) {
    return;
  }

  await store.opportunities[write.mode](write.opportunities);
}

function logSkip(job: Posting, kind: SkipKind, reason: string | null) {
  if (kind === "idempotent") {
    logger.info(
      {
        company: job.company,
        role: job.role,
        url: job.link,
        reason: "Idempotent job check",
      },
      "⏭️ Skipped by idempotent job check"
    );
    return;
  }

  if (kind === "filter") {
    return;
  }

  if (kind === "ai-disabled") {
    logger.info(
      {
        company: job.company,
        role: job.role,
        url: job.link,
      },
      "⏭️ AI is disabled; skipping analysis"
    );
    return;
  }

  if (kind === "ineligible") {
    logger.info(
      {
        company: job.company,
        role: job.role,
        url: job.link,
        reason,
      },
      "⏭️ Skipped by eligibility filter"
    );
    return;
  }

  logger.info(
    {
      company: job.company,
      role: job.role,
      url: job.link,
    },
    "⏭️ Dashboard-only job; notify follows config titles"
  );
}

function logFailure(job: Posting, failure: PostingAnalysisFailure) {
  if (failure.stage === "ai") {
    logger.error(
      {
        company: job.company,
        role: job.role,
        url: job.link,
        reason: failure.reason,
      },
      `${RED_CROSS} AI analysis failed`
    );
    return;
  }

  logger.error(
    {
      company: job.company,
      role: job.role,
      url: job.link,
      code: failure.error.code,
      reason: failure.error.desc || "No JD returned",
    },
    `${RED_CROSS} Failed to fetch JD`
  );
}

function applyOutcome(outcome: JobOutcome, state: ApplyState) {
  switch (outcome.effect) {
    case "deadline":
      state.notStarted += 1;
      state.forceStopped = true;
      return;

    case "fail":
      state.failed += 1;
      logFailure(outcome.job, outcome.failure);
      return;

    case "skip":
      if (outcome.record) {
        state.markAsSeen(outcome.job);
      }

      state.skipped += 1;
      state.skipReasons[outcome.kind] = (state.skipReasons[outcome.kind] ?? 0) + 1;
      state.totalCost += outcome.cost;
      logSkip(outcome.job, outcome.kind, outcome.reason);
      return;

    case "batch":
      state.markAsSeen(outcome.job);
      state.batchedJobs.push(outcome.job.toJob());
      state.batched += 1;
      logger.info(
        {
          company: outcome.job.company,
          role: outcome.job.role,
          url: outcome.job.link,
        },
        "📦 Queued for batch analysis"
      );
      return;

    case "notify":
      state.totalCost += outcome.cost;
      state.currentId += 1;
      outcome.job.id = state.currentId;
      state.markAsSeen(outcome.job);
      state.jobs.push(outcome.job.toJob());
      return;

    default:
      return assertNever(outcome);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

async function flushProcessedJobs(input: {
  state: ApplyState;
  urls: Set<string>;
  opportunities: OpportunityLedger;
  newUrlAdded: boolean;
  remainingMs: () => number;
}) {
  const { state, urls, opportunities, newUrlAdded, remainingMs } = input;

  if (state.batchedJobs.length > 0) {
    await enqueueBatchJobs(state.batchedJobs);
  }

  await store.urls.save(urls);
  await store.jobs.append(state.jobs);
  await saveSeenOpportunities(opportunities);

  if (newUrlAdded) {
    await buildCompanyList(urls, renderBuildProgress);
  }

  if (state.forceStopped) {
    logger.warn(
      {
        remainingSeconds: Math.round(remainingMs() / 1000),
      },
      "⏰ Soft deadline reached. Some jobs were not started."
    );
  }

  if (state.jobs.length > 0) {
    logger.info(
      {
        cost: state.totalCost,
        skipped: state.skipped,
        failed: state.failed,
        batched: state.batched,
      },
      `💰 Processed jobs!!! We found ${state.jobs.length} jobs that match your criteria`
    );
  } else {
    logger.info(
      {
        cost: state.totalCost,
        skipped: state.skipped,
        failed: state.failed,
        batched: state.batched,
      },
      "💰 Currently no newly found jobs that match your criteria"
    );
  }
}

export async function processJobs({
  jobs: rawIncomingJobs,
  urls,
  keys,
  currentId,
  filter,
  softDeadlineMs = DEFAULT_SOFT_DEADLINE_MS,
}: ProcessJobsOptions) {
  const incomingJobs = deduplicateJobs(rawIncomingJobs).map((job) => Posting.from(job));
  const startedAt = Date.now();

  function remainingMs() {
    return Math.max(0, softDeadlineMs - (Date.now() - startedAt));
  }

  function shouldStop() {
    return remainingMs() <= MIN_TIME_TO_START_JOB_MS;
  }

  let newUrlAdded = false;
  const opportunities = createOpportunityLedger(await store.opportunities.load());
  const state = createApplyState(currentId, (posting) => {
    recordSeenOpportunity(opportunities, posting.toJob(), "refresh");
    urls.add(posting.link);
    keys.add(posting.key());
    newUrlAdded = true;
  });

  logger.info({ count: incomingJobs.length }, "👑 Finalizing jobs...");

  const limit = pLimit(AI_CONCURRENCY);
  let completed = 0;
  const total = incomingJobs.length;

  startProgress(total);

  const outcomes = await Promise.all(
    incomingJobs.map((job) =>
      limit(async () => {
        completed++;
        renderProgress(completed, total);
        return resolveJob(job, { keys, shouldStop, filter });
      })
    )
  );

  for (const outcome of outcomes) {
    applyOutcome(outcome, state);
  }

  await flushProcessedJobs({ state, urls, opportunities, newUrlAdded, remainingMs });

  return {
    jobs: state.jobs,
    count: state.jobs.length,
    received: incomingJobs.length,
    opportunitiesAdded: opportunities.appended.length,
    skipped: state.skipped,
    skipReasons: state.skipReasons,
    failed: state.failed,
    batched: state.batched,
    notStarted: state.notStarted,
    totalCost: state.totalCost,
    forceStopped: state.forceStopped,
  };
}

function notificationFilterBucket(kind: SkipKind, reason: string | null) {
  if (kind === "dashboard") return "title";
  if (kind !== "ineligible") return kind;
  if (!reason) return "ineligible";
  if (reason.includes("allowed categories")) return "level";
  if (reason.includes("allowed countries")) return "country";
  if (reason.includes("citizenship")) return "citizenship";
  if (reason.includes("sponsorship")) return "sponsorship";
  return "ineligible";
}

export async function persistAnalyzedJobs(analyzed: Array<{ job: Job; jd: JD; cost: number }>) {
  if (analyzed.length === 0) {
    return {
      jobs: [] as Job[],
      count: 0,
      analyzed: 0,
      reused: 0,
      skipped: 0,
      filterReasons: {} as Record<string, number>,
      opportunitiesAdded: 0,
      opportunitiesUpdated: 0,
      totalCost: 0,
    };
  }

  const storedJobs = await store.jobs.loadInFileOrder();
  const storedByKey = new Map<string, Job>();

  for (const stored of storedJobs) {
    const key = getJobKey(stored.link);

    if (!storedByKey.has(key)) {
      storedByKey.set(key, stored);
    }
  }

  const { currentId: startingId } = await createSyncContext();
  const opportunities = createOpportunityLedger(await store.opportunities.load());
  let opportunitiesAdded = 0;
  let opportunitiesUpdated = 0;

  function noteOpportunity(posting: Posting) {
    const before = opportunities.appended.length;
    recordSeenOpportunity(opportunities, posting.toJob(), "preserve");

    if (opportunities.appended.length > before) {
      opportunitiesAdded += 1;
    } else {
      opportunitiesUpdated += 1;
    }
  }

  const state = createApplyState(startingId, noteOpportunity);
  const seen = new Set<string>();
  let reused = 0;
  const filterReasons: Record<string, number> = {};

  for (const item of analyzed) {
    const key = getJobKey(item.job.link);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    const existing = storedByKey.get(key);

    if (existing) {
      const stored = Posting.from({ ...existing, jd: parseStoredJD(existing.jd) ?? item.jd });
      noteOpportunity(stored);
      state.totalCost += item.cost;
      reused += 1;
      continue;
    }

    const job = Posting.from(item.job);
    job.jd = item.jd;

    const outcome = outcomeAfterAnalysis(job, item.cost);
    applyOutcome(outcome, state);

    if (outcome.effect === "skip") {
      const bucket = notificationFilterBucket(outcome.kind, outcome.reason);
      filterReasons[bucket] = (filterReasons[bucket] ?? 0) + 1;
    }

    if (outcome.effect === "notify") {
      logger.info(
        {
          company: job.company,
          role: job.role,
          url: job.link,
        },
        "✅ Job matches notification criteria"
      );
    }
  }

  await store.jobs.append(state.jobs);
  await saveSeenOpportunities(opportunities);

  if (state.jobs.length > 0) {
    logger.info(
      { cost: state.totalCost, skipped: state.skipped },
      `💰 Batch analysis found ${state.jobs.length} jobs that match your criteria`
    );
  }

  return {
    jobs: state.jobs,
    count: state.jobs.length,
    analyzed: seen.size,
    reused,
    skipped: state.skipped,
    filterReasons,
    opportunitiesAdded,
    opportunitiesUpdated,
    totalCost: state.totalCost,
  };
}
