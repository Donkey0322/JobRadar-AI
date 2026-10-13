import pLimit from "p-limit";

import { RED_CROSS } from "@/constants/log";

import type { JobOutcome, SkipKind } from "./outcome";
import type { OpportunityLedger } from "@/modules/postings/seen";
import type { Job } from "@/types";
import type { JD } from "@/types/jobs";

import { outcomeAfterAnalysis, resolveJob } from "./outcome";

import { buildCompanyList } from "@/modules/employer/build";
import { Posting } from "@/modules/posting";
import { enqueueBatchJobs } from "@/modules/postings/batch";
import {
  createOpportunityLedger,
  recordSeenOpportunity,
  seenOpportunitiesToWrite,
} from "@/modules/postings/seen";
import {
  loadJobs,
  loadOpportunities,
  loadUrls,
  saveJob,
  saveOpportunities,
  saveUrls,
} from "@/utils/data";
import { renderProgress, startProgress } from "@/utils/dev";
import { deduplicateJobs, groupUrlsByKey } from "@/utils/job-key";
import { logger } from "@/utils/logger";

const DEFAULT_SOFT_DEADLINE_MS = 15 * 60 * 1000;
const MIN_TIME_TO_START_JOB_MS = 60 * 1000;
const AI_CONCURRENCY = 5;

export async function createSyncContext() {
  const urls = await loadUrls();
  const keys = new Set(groupUrlsByKey(Array.from(urls)).keys());

  const sentJobs = await loadJobs();
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
    forceStopped: false,
    markAsSeen,
  };
}

async function saveSeenOpportunities(ledger: OpportunityLedger) {
  const write = seenOpportunitiesToWrite(ledger);

  if (!write) {
    return;
  }

  if (write.overwrite) {
    await saveOpportunities(write.opportunities, true);
    return;
  }

  await saveOpportunities(write.opportunities);
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

function applyOutcome(outcome: JobOutcome, state: ApplyState) {
  switch (outcome.effect) {
    case "deadline":
      state.forceStopped = true;
      return;

    case "fail":
      state.failed += 1;
      logger.error(
        {
          company: outcome.job.company,
          role: outcome.job.role,
          url: outcome.job.link,
          code: outcome.error.code,
          reason: outcome.error.desc || "No JD returned",
        },
        `${RED_CROSS} Failed to fetch JD`
      );
      return;

    case "skip":
      if (outcome.record) {
        state.markAsSeen(outcome.job);
      }

      state.skipped += 1;
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

  await saveUrls(urls);
  await saveJob(state.jobs);
  await saveSeenOpportunities(opportunities);

  if (newUrlAdded) {
    await buildCompanyList(urls);
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
  const opportunities = createOpportunityLedger(await loadOpportunities());
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
    skipped: state.skipped,
    failed: state.failed,
    batched: state.batched,
    totalCost: state.totalCost,
    forceStopped: state.forceStopped,
  };
}

export async function persistAnalyzedJobs(analyzed: Array<{ job: Job; jd: JD; cost: number }>) {
  if (analyzed.length === 0) {
    return {
      jobs: [] as Job[],
      count: 0,
      skipped: 0,
      totalCost: 0,
    };
  }

  const { currentId: startingId } = await createSyncContext();
  const opportunities = createOpportunityLedger(await loadOpportunities());
  const state = createApplyState(startingId, (posting) => {
    recordSeenOpportunity(opportunities, posting.toJob(), "preserve");
  });

  for (const item of analyzed) {
    const job = Posting.from(item.job);
    job.jd = item.jd;

    const outcome = outcomeAfterAnalysis(job, item.cost);
    applyOutcome(outcome, state);

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

  await saveJob(state.jobs);
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
    skipped: state.skipped,
    totalCost: state.totalCost,
  };
}
