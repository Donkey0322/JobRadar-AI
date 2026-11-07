import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { JDFetchStatus } from "@/modules/posting/jd";
import type { JD } from "@/types/jobs";

import { getJobKey } from "@/modules/ats/job-key";
import { opportunityStopSaved } from "@/modules/opportunity/stop";
import { parseStoredJD, storedJDFailure } from "@/modules/posting/analysis/validation/ai";

/**
 * Checkpoint for a failed batch submit or collect.
 *
 * Jobs and opportunities stay out of this commit: one of them may have been written
 * without the other. A fresh checkout therefore still has the last pushed datasets.
 * Replay records are limited to this round: the queue, tracking files, and job or
 * opportunity rows that differ from that commit. A JD stored only on an opportunity
 * is replayed too. A record is dropped only when both of those datasets already
 * contain the same valid JD this result would store.
 * Provider batch ids stay until that is true. Queue rows for those inflight jobs are
 * removed so the next run collects the saved id instead of submitting again.
 */
export const RECOVERY_MESSAGE = "chore(batch): checkpoint recoverable batch state [skip ci]";

const QUEUE_PATH = "data/batch/queue.ndjson";
const INFLIGHT_PATH = "data/batch/inflight.json";
const RESULTS_PATH = "data/batch/results.ndjson";
const FAILURES_PATH = "data/batch/failures.ndjson";
const TRACKING_PATHS = [QUEUE_PATH, INFLIGHT_PATH, RESULTS_PATH, FAILURES_PATH];

interface TrackedJob {
  link?: string;
  company?: string;
  role?: string;
  location?: string;
  country?: string;
  jd?: unknown;
  expired?: boolean;
  stop?: {
    reason?: string;
    code?: number;
    failure?: string;
    at?: string;
  };
}

interface PendingResult {
  key: string;
  job: TrackedJob;
  jd: unknown;
  attemptId: string;
  cost: number;
  analyzedAt: string;
}

interface FailureRecord {
  key: string;
  status?: string;
  job?: TrackedJob;
  failure?: { stage?: string; error?: JDFetchStatus };
  lastFailedAt?: string;
  nextAttemptAt?: string;
  attempts?: unknown[];
}

interface InflightBatch {
  name: string;
  jobs?: TrackedJob[];
}

export interface BatchSnapshot {
  jobs: TrackedJob[];
  opportunities: TrackedJob[];
  queue: TrackedJob[];
  inflight: InflightBatch[];
  results: PendingResult[];
  failures: FailureRecord[];
}

export interface RecoveryPlan {
  queue: TrackedJob[];
  inflight: InflightBatch[];
  results: PendingResult[];
  failures: FailureRecord[];
}

function jobKey(job: TrackedJob | undefined): string {
  if (!job?.link) {
    return "";
  }

  return getJobKey(job.link);
}

interface KeyIndex {
  first: Map<string, TrackedJob>;
  count: Map<string, number>;
}

/** First row per key, matching `persistAnalyzedJobs`, plus a count for change detection. */
function indexRows(rows: TrackedJob[]): KeyIndex {
  const first = new Map<string, TrackedJob>();
  const count = new Map<string, number>();

  for (const row of rows) {
    const key = jobKey(row);

    if (!key) {
      continue;
    }

    count.set(key, (count.get(key) ?? 0) + 1);

    if (!first.has(key)) {
      first.set(key, row);
    }
  }

  return { first, count };
}

function queuedJob(job: TrackedJob): TrackedJob {
  return {
    company: job.company,
    role: job.role,
    link: job.link,
    location: job.location,
    ...(job.country ? { country: job.country } : {}),
  };
}

function jdSignature(jd: JD): string {
  return JSON.stringify({
    citizenship: jd.citizenship,
    sponsorship: jd.sponsorship,
    qualifications: jd.qualifications ?? null,
    country: jd.country,
    location: jd.location,
    category: jd.category,
    season: jd.season,
  });
}

/**
 * True when the last pushed job and opportunity both already store this JD.
 * A shared key is not enough: persist keeps an existing job row and only fills an
 * opportunity from a valid stored JD, or from this result when that JD is missing.
 */
function reliablySaved(
  jobs: KeyIndex,
  opportunities: KeyIndex,
  key: string,
  expected: JD | null
): boolean {
  const job = jobs.first.get(key);
  const opportunity = opportunities.first.get(key);

  if (!job || !opportunity) {
    return false;
  }

  const jobJD = parseStoredJD(job.jd);
  const opportunityJD = parseStoredJD(opportunity.jd);

  if (!jobJD || !opportunityJD || jdSignature(jobJD) !== jdSignature(opportunityJD)) {
    return false;
  }

  return expected === null || jdSignature(jobJD) === jdSignature(expected);
}

function storedJD(row: TrackedJob | undefined): JD | null {
  if (!row || row.jd == null) {
    return null;
  }

  return parseStoredJD(row.jd);
}

/**
 * JD to replay when this round has no result record.
 * A valid job JD wins, as in `persistAnalyzedJobs` (`parseStoredJD(existing.jd) ?? item.jd`).
 * Otherwise the opportunity JD is used. That is where an analysis is stored when the
 * job is filtered out. An invalid JD is reported only for a row that changed this round
 * and has no valid JD on either side.
 */
function replayFromDatasets(
  key: string,
  jobs: KeyIndex,
  opportunities: KeyIndex,
  jobChanged: boolean,
  opportunityChanged: boolean
): { jd: JD; row: TrackedJob } | { reason: string } | null {
  const jobRow = jobs.first.get(key);
  const opportunityRow = opportunities.first.get(key);
  const jobJD = storedJD(jobRow);
  const opportunityJD = storedJD(opportunityRow);

  if (jobJD && jobRow) {
    return { jd: jobJD, row: jobRow };
  }

  if (opportunityJD) {
    const row = jobRow ?? opportunityRow;

    return row ? { jd: opportunityJD, row } : null;
  }

  if (!jobChanged && !opportunityChanged) {
    return null;
  }

  const reason =
    (jobRow && jobRow.jd != null ? storedJDFailure(jobRow.jd) : null) ??
    (opportunityRow && opportunityRow.jd != null ? storedJDFailure(opportunityRow.jd) : null);

  return reason ? { reason } : null;
}

function rowChanged(head: KeyIndex, work: KeyIndex, key: string): boolean {
  if ((head.count.get(key) ?? 0) !== (work.count.get(key) ?? 0)) {
    return true;
  }

  const previous = head.first.get(key);
  const current = work.first.get(key);

  if (!previous || !current) {
    return previous !== current;
  }

  return JSON.stringify(previous) !== JSON.stringify(current);
}

/**
 * Tracking files to commit. `head` is the last commit a fresh checkout would see.
 * `work` is the failed run, including dataset writes that this commit will not keep.
 * Throws when a row changed this round and its JD cannot be replayed; the caller
 * must not commit or reset after that.
 */
export function planBatchRecovery(head: BatchSnapshot, work: BatchSnapshot): RecoveryPlan {
  const headJobs = indexRows(head.jobs);
  const headOpportunities = indexRows(head.opportunities);
  const workJobs = indexRows(work.jobs);
  const workOpportunities = indexRows(work.opportunities);
  const candidates = new Set<string>();

  function addCandidate(key: string) {
    if (key) {
      candidates.add(key);
    }
  }

  for (const job of [...head.queue, ...work.queue]) {
    addCandidate(jobKey(job));
  }

  for (const result of [...head.results, ...work.results]) {
    addCandidate(result.key);
  }

  for (const record of [...head.failures, ...work.failures]) {
    addCandidate(record.key);
  }

  for (const batch of [...head.inflight, ...work.inflight]) {
    for (const job of batch.jobs ?? []) {
      addCandidate(jobKey(job));
    }
  }

  const changedJobs = new Set<string>();
  const changedOpportunities = new Set<string>();

  for (const key of new Set([...workJobs.first.keys(), ...headJobs.first.keys()])) {
    if (rowChanged(headJobs, workJobs, key)) {
      changedJobs.add(key);
      addCandidate(key);
    }
  }

  for (const key of new Set([
    ...workOpportunities.first.keys(),
    ...headOpportunities.first.keys(),
  ])) {
    if (rowChanged(headOpportunities, workOpportunities, key)) {
      changedOpportunities.add(key);
      addCandidate(key);
    }
  }

  const workNames = new Set(work.inflight.map((batch) => batch.name));
  const workFailureKeys = new Set(work.failures.map((record) => record.key));
  const resultByKey = new Map<string, PendingResult>();

  for (const result of head.results) {
    resultByKey.set(result.key, result);
  }

  // The failed run replaces a committed result for the same key.
  for (const result of work.results) {
    resultByKey.set(result.key, result);
  }

  function saved(key: string, expected: JD | null): boolean {
    return reliablySaved(headJobs, headOpportunities, key, expected);
  }

  function replayableJD(key: string): JD | null {
    const result = resultByKey.get(key);
    const fromResult = result ? parseStoredJD(result.jd) : null;

    if (fromResult) {
      return fromResult;
    }

    const row = workJobs.first.get(key);

    return row ? parseStoredJD(row.jd) : null;
  }

  const inflight: InflightBatch[] = [];
  const seenNames = new Set<string>();

  for (const batch of [...work.inflight, ...head.inflight]) {
    if (seenNames.has(batch.name)) {
      continue;
    }

    const covered = (batch.jobs ?? []).map((job) => jobKey(job)).filter((key) => key);
    const fromWork = workNames.has(batch.name);
    const alreadySaved =
      covered.length > 0 &&
      covered.every((key) => {
        const carried = (batch.jobs ?? []).find((job) => jobKey(job) === key);
        const expected = carried ? parseStoredJD(carried.jd) : null;

        return saved(key, expected);
      });
    const needsCollect = covered.some((key) => !saved(key, null) && !replayableJD(key));

    if (alreadySaved || (!fromWork && !needsCollect)) {
      continue;
    }

    seenNames.add(batch.name);
    inflight.push(batch);
  }

  const inflightKeys = new Set<string>();

  for (const batch of inflight) {
    for (const job of batch.jobs ?? []) {
      const key = jobKey(job);

      if (key) {
        inflightKeys.add(key);
      }
    }
  }

  const results: PendingResult[] = [];
  const seenResults = new Set<string>();

  function addResult(result: PendingResult) {
    if (!result.key || inflightKeys.has(result.key) || seenResults.has(result.key)) {
      return;
    }

    const jd = parseStoredJD(result.jd);

    if (!jd) {
      throw new Error(
        `Cannot recover ${result.key}: stored JD failed validation (${storedJDFailure(result.jd) ?? "invalid JD"}). Recovery left the working tree unchanged.`
      );
    }

    if (saved(result.key, jd)) {
      return;
    }

    seenResults.add(result.key);
    results.push({ ...result, jd });
  }

  for (const result of work.results) {
    addResult(result);
  }

  for (const result of head.results) {
    addResult(result);
  }

  for (const key of candidates) {
    if (seenResults.has(key) || inflightKeys.has(key) || resultByKey.has(key)) {
      continue;
    }

    const source = replayFromDatasets(
      key,
      workJobs,
      workOpportunities,
      changedJobs.has(key),
      changedOpportunities.has(key)
    );

    if (!source) {
      continue;
    }

    if ("reason" in source) {
      throw new Error(
        `Cannot recover ${key}: stored JD failed validation (${source.reason}). Recovery left the working tree unchanged.`
      );
    }

    if (saved(key, source.jd)) {
      continue;
    }

    seenResults.add(key);
    results.push({
      key,
      job: queuedJob(source.row),
      jd: source.jd,
      attemptId: `recovered:${key}`,
      cost: 0,
      analyzedAt: new Date().toISOString(),
    });
  }

  const failures = new Map<string, FailureRecord>();

  for (const record of head.failures) {
    failures.set(record.key, record);
  }

  for (const record of work.failures) {
    failures.set(record.key, record);
  }

  for (const [key, record] of failures) {
    const removedAfterSuccess = !workFailureKeys.has(key);
    const keptJD = parseStoredJD(resultByKey.get(key)?.jd);

    if (removedAfterSuccess && (saved(key, keptJD) || seenResults.has(key))) {
      failures.delete(record.key);
    }
  }

  const failed = new Set<string>();

  for (const record of failures.values()) {
    if (record.status === "failed") {
      failed.add(record.key);
    }
  }

  // A failed fetch stays queued until HEAD has this record's stop. An older stop
  // does not count. Recovery discards an uncommitted opportunity write, so the
  // queue entry has to come back with the attempt count and nextAttemptAt intact.
  function fetchStopPending(key: string): boolean {
    const record = failures.get(key);
    const error = record?.failure?.error;

    if (record?.status !== "failed" || record.failure?.stage !== "fetch") {
      return false;
    }

    if (
      !error ||
      typeof error.code !== "number" ||
      typeof error.desc !== "string" ||
      !record.lastFailedAt
    ) {
      return true;
    }

    return !opportunityStopSaved(headOpportunities.first.get(key), error, record.lastFailedAt);
  }

  const queue = work.queue.filter((job) => {
    const key = jobKey(job);

    if (!key || inflightKeys.has(key) || saved(key, null)) {
      return false;
    }

    return !failed.has(key) || fetchStopPending(key);
  });
  const queued = new Set(queue.map((job) => jobKey(job)));

  for (const record of failures.values()) {
    if (!record.job || !fetchStopPending(record.key) || queued.has(record.key)) {
      continue;
    }

    queue.push(record.job);
    queued.add(record.key);
  }

  return {
    queue,
    inflight,
    results,
    failures: [...failures.values()],
  };
}

function ndjson(records: unknown[]): string {
  if (records.length === 0) {
    return "";
  }

  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function parseNdjson(file: string, text: string): unknown[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line)
    .map((line, index) => {
      try {
        return JSON.parse(line) as unknown;
      } catch (error) {
        throw new Error(`Invalid NDJSON in ${file} at line ${index + 1}`, { cause: error });
      }
    });
}

function asJobs(file: string, records: unknown[]): TrackedJob[] {
  return records.map((record, index) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`${file} line ${index + 1} is not a job object`);
    }

    return record as TrackedJob;
  });
}

function asResults(file: string, records: unknown[]): PendingResult[] {
  return records.map((record, index) => {
    if (
      !record ||
      typeof record !== "object" ||
      Array.isArray(record) ||
      typeof (record as PendingResult).key !== "string" ||
      typeof (record as PendingResult).job !== "object"
    ) {
      throw new Error(`${file} line ${index + 1} is not a saved batch result`);
    }

    return record as PendingResult;
  });
}

function asFailures(file: string, records: unknown[]): FailureRecord[] {
  return records.map((record, index) => {
    if (
      !record ||
      typeof record !== "object" ||
      Array.isArray(record) ||
      typeof (record as FailureRecord).key !== "string"
    ) {
      throw new Error(`${file} line ${index + 1} is not a batch failure record`);
    }

    return record as FailureRecord;
  });
}

function asInflight(file: string, parsed: unknown): InflightBatch[] {
  if (!Array.isArray(parsed)) {
    throw new Error(`${file} must be a JSON array of provider batches`);
  }

  return parsed.map((batch, index) => {
    if (
      !batch ||
      typeof batch !== "object" ||
      Array.isArray(batch) ||
      typeof (batch as InflightBatch).name !== "string"
    ) {
      throw new Error(`${file} entry ${index + 1} is missing a provider batch id`);
    }

    return batch as InflightBatch;
  });
}

function git(root: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function gitText(root: string, args: string[]): string {
  const result = git(root, args);

  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} exited ${result.status}`);
  }

  return result.stdout;
}

function gitShow(root: string, spec: string): string | null {
  const temporary = path.join(
    tmpdir(),
    `jobradar-git-show-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  const fd = openSync(temporary, "w");
  let opened = true;

  try {
    // stdout goes to a file. spawnSync's default 1 MiB pipe limit would truncate a
    // real archive and report ENOBUFS; that limit only applies to piped stdio.
    const result = spawnSync("git", ["show", spec], {
      cwd: root,
      stdio: ["ignore", fd, "pipe"],
      maxBuffer: 1024 * 1024,
    });

    closeSync(fd);
    opened = false;
    const stderr = result.stderr?.toString("utf8") ?? "";

    if (result.error) {
      throw new Error(`git show ${spec} failed: ${result.error.message}`);
    }

    if (result.status !== 0) {
      if (/does not exist in |exists on disk, but not in /.test(stderr)) {
        return null;
      }

      throw new Error(stderr.trim() || `git show ${spec} exited ${result.status}`);
    }

    return readFileSync(temporary, "utf8");
  } finally {
    if (opened) {
      closeSync(fd);
    }

    rmSync(temporary, { force: true });
  }
}

function isDataset(file: string, kind: "jobs" | "opportunities"): boolean {
  const base = path.basename(file);
  return base === `${kind}.ndjson` || new RegExp(`^${kind}-\\d+\\.ndjson$`).test(base);
}

function datasetText(
  root: string,
  files: string[],
  read: (file: string) => string | null
): TrackedJob[] {
  const jobs: TrackedJob[] = [];

  for (const file of files) {
    const text = read(file);

    if (text === null) {
      continue;
    }

    jobs.push(...asJobs(file, parseNdjson(file, text)));
  }

  return jobs;
}

function datasetNames(root: string, names: string[], kind: "jobs" | "opportunities"): string[] {
  return names.filter((file) => file.startsWith("data/") && isDataset(file, kind)).sort();
}

function readSnapshot(root: string, source: "head" | "work"): BatchSnapshot {
  const headNames =
    source === "head"
      ? gitText(root, ["ls-tree", "-r", "--name-only", "HEAD", "--", "data"])
          .split(/\r?\n/)
          .filter((file) => file)
      : [];
  const read = (file: string) =>
    source === "head" ? gitShow(root, `HEAD:${file}`) : readOptional(root, file);

  const queueText = read(QUEUE_PATH) ?? "";
  const failureText = read(FAILURES_PATH) ?? "";
  const resultText = read(RESULTS_PATH) ?? "";
  const inflightText = read(INFLIGHT_PATH);
  const names =
    source === "head"
      ? headNames
      : [
          ...datasetNames(
            root,
            existsSync(path.join(root, "data/jobs.ndjson")) ? ["data/jobs.ndjson"] : [],
            "jobs"
          ),
          ...datasetNames(
            root,
            existsSync(path.join(root, "data/opportunities.ndjson"))
              ? ["data/opportunities.ndjson"]
              : [],
            "opportunities"
          ),
          ...archiveNames(root),
        ];

  return {
    jobs: datasetText(root, datasetNames(root, names, "jobs"), read),
    opportunities: datasetText(root, datasetNames(root, names, "opportunities"), read),
    queue: asJobs(QUEUE_PATH, parseNdjson(QUEUE_PATH, queueText)),
    inflight: asInflight(
      INFLIGHT_PATH,
      inflightText === null ? [] : (JSON.parse(inflightText) as unknown)
    ),
    results: asResults(RESULTS_PATH, parseNdjson(RESULTS_PATH, resultText)),
    failures: asFailures(FAILURES_PATH, parseNdjson(FAILURES_PATH, failureText)),
  };
}

function readOptional(root: string, file: string): string | null {
  const full = path.join(root, file);

  if (!existsSync(full)) {
    return null;
  }

  return readFileSync(full, "utf8");
}

function archiveNames(root: string): string[] {
  const directory = path.join(root, "data/archive");

  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory).map((name) => `data/archive/${name}`);
}

function writeAtomic(root: string, file: string, body: string) {
  const full = path.join(root, file);
  const temporary = path.join(path.dirname(full), `.${path.basename(file)}.${process.pid}.tmp`);
  writeFileSync(temporary, body);
  renameSync(temporary, full);
}

function emit(committed: boolean) {
  const line = `committed=${committed}\n`;
  const target = process.env.GITHUB_OUTPUT;

  if (target) {
    appendFileSync(target, line);
  }

  process.stdout.write(line);
}

function recover(root: string) {
  gitText(root, ["rev-parse", "--verify", "HEAD"]);
  const plan = planBatchRecovery(readSnapshot(root, "head"), readSnapshot(root, "work"));
  const files = new Map<string, string>([
    [QUEUE_PATH, ndjson(plan.queue)],
    [INFLIGHT_PATH, `${JSON.stringify(plan.inflight, null, 2)}\n`],
    [RESULTS_PATH, ndjson(plan.results)],
    [FAILURES_PATH, ndjson(plan.failures)],
  ]);

  for (const [file, body] of files) {
    writeAtomic(root, file, body);
  }

  // Drop anything already staged, including a partial jobs write, before staging
  // the tracking files. The worktree itself is left alone until the commit exists.
  gitText(root, ["reset", "-q"]);
  gitText(root, ["add", "--", ...TRACKING_PATHS]);

  if (git(root, ["diff", "--cached", "--quiet"]).status === 0) {
    gitText(root, ["reset", "--hard", "HEAD"]);
    gitText(root, ["clean", "-fdq", "--", "data/"]);
    emit(false);
    return;
  }

  gitText(root, ["config", "--local", "user.name", "actions-bot"]);
  gitText(root, ["config", "--local", "user.email", "actions@github.com"]);
  const committed = git(root, ["commit", "-m", RECOVERY_MESSAGE]);

  if (committed.status !== 0) {
    throw new Error(committed.stderr || "Recovery commit failed; working tree was left in place");
  }

  gitText(root, ["reset", "--hard", "HEAD"]);
  gitText(root, ["clean", "-fdq", "--", "data/"]);
  emit(true);
}

function main() {
  try {
    recover(path.resolve(process.argv[2] ?? process.cwd()));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

const entry = process.argv[1];

if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  main();
}
