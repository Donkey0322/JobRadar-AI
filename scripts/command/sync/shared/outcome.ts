import type { Posting } from "@/modules/posting";
import type { JDFetchStatus } from "@/modules/posting/jd";
import type { Job } from "@/types";

export type SkipKind = "idempotent" | "filter" | "ineligible" | "dashboard";

interface DeadlineOutcome {
  effect: "deadline";
  job: Posting;
}

interface SkipOutcome {
  effect: "skip";
  job: Posting;
  record: boolean;
  kind: SkipKind;
  reason: string | null;
  cost: number;
}

interface BatchOutcome {
  effect: "batch";
  job: Posting;
}

interface FailOutcome {
  effect: "fail";
  job: Posting;
  error: JDFetchStatus;
}

interface NotifyOutcome {
  effect: "notify";
  job: Posting;
  cost: number;
}

export type JobOutcome = DeadlineOutcome | SkipOutcome | BatchOutcome | FailOutcome | NotifyOutcome;

export interface ResolveJobGates {
  keys: ReadonlySet<string>;
  shouldStop: () => boolean;
  filter?: (job: Job) => Promise<boolean> | boolean;
}

function deadline(job: Posting): DeadlineOutcome {
  return { effect: "deadline", job };
}

function skip(job: Posting, kind: "idempotent" | "filter"): SkipOutcome;
function skip(job: Posting, kind: "dashboard", extra: { cost: number }): SkipOutcome;
function skip(
  job: Posting,
  kind: "ineligible",
  extra: { cost: number; reason: string | null }
): SkipOutcome;
function skip(
  job: Posting,
  kind: SkipKind,
  extra?: { cost?: number; reason?: string | null }
): SkipOutcome {
  return {
    effect: "skip",
    job,
    record: kind !== "idempotent",
    kind,
    reason: extra?.reason ?? null,
    cost: extra?.cost ?? 0,
  };
}

function batch(job: Posting): BatchOutcome {
  return { effect: "batch", job };
}

function fail(job: Posting, error: JDFetchStatus): FailOutcome {
  return { effect: "fail", job, error };
}

function notify(job: Posting, cost: number): NotifyOutcome {
  return { effect: "notify", job, cost };
}

export const Outcome = {
  deadline,
  skip,
  batch,
  fail,
  notify,
};

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

export function outcomeAfterAnalysis(job: Posting, cost: number): JobOutcome {
  const decision = job.decideNotification();

  switch (decision.action) {
    case "notify":
      return Outcome.notify(job, cost);
    case "skip":
      switch (decision.kind) {
        case "ineligible":
          return Outcome.skip(job, "ineligible", { cost, reason: decision.reason });
        case "dashboard":
          return Outcome.skip(job, "dashboard", { cost });
        default:
          return assertNever(decision);
      }
    default:
      return assertNever(decision);
  }
}

export async function resolveJob(job: Posting, gates: ResolveJobGates): Promise<JobOutcome> {
  if (gates.keys.has(job.key())) {
    return Outcome.skip(job, "idempotent");
  }

  if (gates.shouldStop()) {
    return Outcome.deadline(job);
  }

  if (gates.filter && (await gates.filter(job))) {
    return Outcome.skip(job, "filter");
  }

  if (job.shouldBatchAnalyze()) {
    return Outcome.batch(job);
  }

  const result = await job.analyze();

  if (!result.jd) {
    return Outcome.fail(job, result.error);
  }

  return outcomeAfterAnalysis(job, result.cost);
}
