/**
 * Routing decisions shared by the job workflows.
 *
 * The exported functions are what the tests import. The CLI prints GitHub
 * Actions outputs and uses only Node built-ins, so the gate can run before
 * pnpm install.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const LA = "America/Los_Angeles";

export const SCAN_CRONS = ["10 7-23 * * 1", "10 8-23 * * 2-5", "10 0-7 * * 2-6"];
export const SYNC_CRONS = ["*/20 14-23 * * *", "*/20 0-7 * * *"];

// Commits that already call Publish Jobs. A later push of the same commit must
// not board or notify a second time. The checkpoint prefix is included because
// its message also contains [skip ci], which suppresses push workflows; Batch
// publishes that commit itself.
export const PIPELINE_PREFIXES = [
  "chore(discovery):",
  "chore(community):",
  "chore(batch): collect",
  "chore(batch): checkpoint",
  "data: add job from issue",
];

// GitHub skips push and pull_request workflows when any commit in the push
// contains one of these markers.
// https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs
const SKIP_MARKERS = ["[skip ci]", "[ci skip]", "[no ci]", "[skip actions]", "[actions skip]"];
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
// Push workflows read the webhook payload. Its commits array holds at most 2048
// commits. The Events API timeline caps a different PushEvent list at 20.
export const WEBHOOK_PUSH_COMMIT_CAP = 2048;

const BOARD_FILES = ["config.json", "data/opportunities.ndjson"];
const BOARD_MODULE_PREFIX = "src/modules/board/";
const WEEKDAYS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export const MAINTENANCE = {
  clean: {
    argv: ["pnpm", "jobctl", "job", "clean"],
    paths: ["data"],
    message: "chore(clean-outdated-url): clean outdated url",
  },
  dedup: {
    argv: ["pnpm", "jobctl", "job", "dedup"],
    paths: ["data"],
    message: "chore(maintenance): dedup jobs",
  },
  "company refresh": {
    argv: ["pnpm", "jobctl", "company", "refresh"],
    paths: ["data"],
    message: "chore(maintenance): refresh companies",
  },
  "board refresh": {
    argv: ["pnpm", "jobctl", "board", "refresh"],
    paths: ["README.md", "job-postings", "assets/featured-badges"],
    message: "docs: update generated job boards",
  },
};

function zoneParts(instant) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LA,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  }).formatToParts(instant);
  const map = {};
  for (const part of parts) map[part.type] = part.value;
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: WEEKDAYS[map.weekday],
  };
}

function zoneOffsetMs(instant) {
  const parts = zoneParts(instant);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return asUtc - instant.getTime();
}

function wallTimeInZone(year, month, day, hour, minute, second, millisecond) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  let utc = utcGuess - zoneOffsetMs(new Date(utcGuess));
  utc = utcGuess - zoneOffsetMs(new Date(utc));
  return new Date(utc);
}

function parseWorkflowNow(raw) {
  if (!raw) return new Date();
  if (/(?:[zZ]|[+-]\d{2}:\d{2})$/.test(raw)) {
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) throw new Error(`invalid NOW ${raw}`);
    return parsed;
  }
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/);
  if (!match) throw new Error(`invalid NOW ${raw}`);
  const fraction = match[7] ? match[7].slice(0, 3).padEnd(3, "0") : "0";
  return wallTimeInZone(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] ?? 0),
    Number(fraction)
  );
}

export function jobsGate(eventName, task, schedule, now) {
  const local = zoneParts(now instanceof Date ? now : parseWorkflowNow(now));
  if (!local.weekday || Number.isNaN(local.hour)) throw new Error("Could not read California time");

  if (eventName === "workflow_dispatch") {
    if (task !== "scan" && task !== "sync") throw new Error(`unknown jobs task ${task}`);
    return {
      should_run: "true",
      task,
      lookback_days: task === "scan" ? "2" : "",
      message: "",
    };
  }

  if (eventName !== "schedule") throw new Error(`unknown jobs event ${eventName}`);
  if (SCAN_CRONS.includes(schedule)) return scanWindow(local);
  if (SYNC_CRONS.includes(schedule)) return syncWindow(local);
  throw new Error(`unknown jobs schedule ${schedule}`);
}

function scanWindow(local) {
  if (local.weekday > 5) {
    return {
      should_run: "false",
      task: "scan",
      lookback_days: "",
      message: "Skipping ATS discovery on the California weekend.",
    };
  }

  const lookback = local.weekday === 1 && local.hour === 0 ? "3" : "2";
  return {
    should_run: "true",
    task: "scan",
    lookback_days: lookback,
    message: lookback === "3" ? "Using a 3-day lookback for the Monday weekend catch-up." : "",
  };
}

function syncWindow(local) {
  if (local.hour >= 7 && local.hour <= 23) {
    return { should_run: "true", task: "sync", lookback_days: "", message: "" };
  }
  return {
    should_run: "false",
    task: "sync",
    lookback_days: "",
    message: "Skipping community sync outside 07:00-23:40 California time.",
  };
}

function skipsPush(message) {
  return SKIP_MARKERS.some((marker) => message.includes(marker));
}

export function batchShouldStart(eventName, commitMessage) {
  if (eventName !== "push") return true;
  if (skipsPush(commitMessage)) return false;
  if (firstLine(commitMessage).startsWith("chore(batch): collect")) return false;
  return true;
}

// eventName is the caller's event. A reusable workflow keeps that name, so a
// manual Jobs run still arrives as workflow_dispatch. Queue lines, inflight
// entries, and saved real-time results are the only signal, for every caller.
export function batchDue(eventName, queue, inflight, results = null) {
  void eventName;
  const hasLines = (text) => Boolean(text && text.split(/\r?\n/).some((line) => line.trim()));
  if (hasLines(queue) || hasLines(results)) return true;
  if (!inflight) return false;
  const payload = JSON.parse(inflight);
  return Array.isArray(payload) && payload.length > 0;
}

// An idle batch skips submit, collect, and both publishes. The caller stays
// successful. A failed fetch, publish, or batch still fails the caller.
export function jobsResultAfterBatch(fetchResult, publishResult, batchResult) {
  if (fetchResult !== "success") return fetchResult;
  if (publishResult !== "success" && publishResult !== "skipped") return publishResult;
  if (batchResult !== "success" && batchResult !== "skipped") return batchResult;
  return "success";
}

function isPipelineCommit(message) {
  const first = firstLine(message);
  return PIPELINE_PREFIXES.some((prefix) => first.startsWith(prefix));
}

function isBoardFile(filePath) {
  if (BOARD_FILES.includes(filePath) || filePath.startsWith(BOARD_MODULE_PREFIX)) return true;
  if (!filePath.startsWith("data/archive/")) return false;
  const name = filePath.slice("data/archive/".length);
  return !name.includes("/") && name.startsWith("opportunities-") && name.endsWith(".ndjson");
}

export function classifyFiles(files) {
  const board = files.some((filePath) => isBoardFile(filePath));
  const notify = files.includes("data/jobs.ndjson");
  return { board, notify, run: board || notify };
}

export function routePush(message, files, messages = null) {
  const subjects = (messages ?? [message]).filter((subject) => subject);
  if (
    subjects.length > 0 &&
    subjects.every((subject) => isPipelineCommit(subject) || skipsPush(subject))
  ) {
    return { run: false, board: false, notify: false };
  }
  return classifyFiles(files);
}

function isZeroSha(value) {
  return value.length > 0 && [...value].every((char) => char === "0");
}

export function resolvePushBounds(before, after, oldestParents, commitIds) {
  const parents = oldestParents ?? [];
  if (before && !isZeroSha(before)) {
    return { status: "range", from: before, to: after, reason: "" };
  }
  if (commitIds.length >= WEBHOOK_PUSH_COMMIT_CAP) {
    return {
      status: "incomplete",
      from: "",
      to: after,
      reason:
        "This push created a ref, so before is zero. " +
        `github.event.commits has ${commitIds.length} entries, the webhook maximum of ` +
        `${WEBHOOK_PUSH_COMMIT_CAP}, and may omit older commits. ` +
        "Notification was not sent.",
    };
  }
  if (commitIds.length === 0) return { status: "empty", from: after, to: after, reason: "" };
  if (parents.length === 0) return { status: "range", from: EMPTY_TREE, to: after, reason: "" };
  return { status: "range", from: parents[0], to: after, reason: "" };
}

export function collectShouldContinue(submitResult, checkpointResult) {
  return submitResult === "success" && ["success", "failure", "skipped"].includes(checkpointResult);
}

// ready: the objects are already local. fetch: ask origin for the commit once.
// unshallow: the shallow clone still cannot see a parent or merge base.
// fail: stop. Do not widen the notification range and do not force-push.
export function commitHistoryPlan({ shallow, commitPresent, parentRequired, parentPresent, fetched }) {
  if (commitPresent && (!parentRequired || parentPresent)) return "ready";
  if (!fetched) return "fetch";
  if (shallow) return "unshallow";
  return "fail";
}

export function rebaseHistoryPlan({ shallow, mergeBasePresent, unshallowed }) {
  if (mergeBasePresent) return "ready";
  if (shallow && !unshallowed) return "unshallow";
  return "fail";
}

export function notifyEnabled(config) {
  const dashboard = config.dashboard || {};
  if (!Object.hasOwn(dashboard, "notify")) return true;
  return Boolean(dashboard.notify);
}

export function shouldNotify(boardResult, notify, send, prepareResult = "success", cancelled = false) {
  if (cancelled || prepareResult === "cancelled" || boardResult === "cancelled") return false;
  return (
    prepareResult === "success" &&
    Boolean(notify) &&
    Boolean(send) &&
    ["success", "failure", "skipped"].includes(boardResult)
  );
}

export function shouldStartWrite(cancelled) {
  return !cancelled;
}

export function batchConclusion({ checkpointPublish, collect, collectPublish }) {
  const outcomes = [checkpointPublish, collect, collectPublish];
  if (outcomes.includes("cancelled")) return "cancelled";
  if (outcomes.includes("failure")) return "failure";
  return "success";
}

export function maintenancePlan(eventName, task) {
  const selected = eventName === "schedule" ? "clean" : task;
  const plan = MAINTENANCE[selected];
  if (!plan) throw new Error(`unknown maintenance task ${selected}`);
  return { task: selected, argv: plan.argv, paths: plan.paths, message: plan.message };
}

function firstLine(message) {
  if (!message) return "";
  return message.split(/\r?\n/, 1)[0];
}

function emit(pairs) {
  const text = Object.entries(pairs)
    .map(([key, value]) => `${key}=${value}\n`)
    .join("");
  const target = process.env.GITHUB_OUTPUT;
  if (target) {
    appendFileSync(target, text, "utf8");
    return;
  }
  process.stdout.write(text);
}

function gitResult(args, options) {
  const result = spawnSync("git", args, options);
  if (result.error) throw result.error;
  return result;
}

function gitText(args) {
  const result = gitResult(args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git exited ${result.status}`);
  return result.stdout;
}

function gitRun(args, options = {}) {
  const result = gitResult(args, { stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(`git ${args[0]} exited ${result.status}`);
}

function changedFiles(before, sha) {
  if (!before || before === sha) return [];
  return gitText(["diff", "--name-only", before, sha])
    .split(/\r?\n/)
    .filter((line) => line);
}

function commitParents(sha) {
  const result = gitResult(["rev-parse", `${sha}^@`], { encoding: "utf8" });
  if (result.status !== 0) return null;
  return result.stdout.split(/\s+/).filter((line) => line);
}

function commitSubjects(fromSha, toSha) {
  if (!fromSha || fromSha === toSha) return [];
  const spec = fromSha === EMPTY_TREE ? toSha : `${fromSha}..${toSha}`;
  return gitText(["log", "--format=%s", spec])
    .split(/\r?\n/)
    .filter((line) => line);
}

function stderr(message) {
  process.stderr.write(`${message}\n`);
}

function jobsGateCli() {
  const result = jobsGate(
    process.env.EVENT_NAME ?? "",
    process.env.TASK ?? "",
    process.env.SCHEDULE ?? "",
    parseWorkflowNow(process.env.NOW)
  );
  if (result.message) stderr(result.message);
  emit({
    should_run: result.should_run,
    task: result.task,
    lookback_days: result.lookback_days,
  });
}

function batchDueCli() {
  const eventName = process.env.EVENT_NAME ?? "";
  const due = batchDue(
    eventName,
    readOptional("data/batch/queue.ndjson"),
    readOptional("data/batch/inflight.json"),
    readOptional("data/batch/results.ndjson")
  );
  stderr(due ? "Batch work is pending." : "No queued or inflight batch work.");
  emit({ due: due ? "true" : "false" });
}

function reportIncompleteRange(reason) {
  stderr(reason);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `${reason}\n`, "utf8");
}

function publishRouteCli() {
  const before = process.env.BEFORE ?? "";
  const after = process.env.SHA;
  if (!after) throw new Error("SHA is required");
  const rawIds = process.env.PUSH_COMMITS ?? "";
  const parsedIds = rawIds ? JSON.parse(rawIds) : [];
  const commitIds = Array.isArray(parsedIds) ? parsedIds : [];
  const newRef = !before || isZeroSha(before);
  let parents = [];
  if (newRef && commitIds.length > 0 && commitIds.length < WEBHOOK_PUSH_COMMIT_CAP) {
    parents = commitParents(commitIds[0]);
    if (parents === null) {
      reportIncompleteRange(
        "This push created a ref, so before is zero. " +
          `The parent of the oldest pushed commit ${commitIds[0]} could not be resolved. ` +
          "Notification was not sent."
      );
      process.exit(1);
    }
  }
  const bounds = resolvePushBounds(before, after, parents, commitIds);
  if (bounds.status === "incomplete") {
    reportIncompleteRange(bounds.reason);
    process.exit(1);
  }
  if (bounds.from === EMPTY_TREE) {
    const hashed = gitResult(["hash-object", "-t", "tree", "--stdin"], { input: "" });
    if (hashed.status !== 0) throw new Error(hashed.stderr?.toString() || "git hash-object failed");
  }
  const files = changedFiles(bounds.from, bounds.to);
  const route = routePush(
    process.env.COMMIT_MESSAGE ?? "",
    files,
    commitSubjects(bounds.from, bounds.to)
  );
  emitRoute(bounds.to, route, bounds.from);
}

function classifyHeadCli() {
  const sha = gitText(["rev-parse", "HEAD"]).trim();
  emitRoute(sha, classifyFiles(changedFiles(`${sha}~1`, sha)));
}

function notifyEnabledCli() {
  const raw = gitText(["show", `${process.env.DATA_SHA}:config.json`]);
  const enabled = notifyEnabled(JSON.parse(raw));
  stderr(enabled ? "Notifications enabled." : "Notifications disabled.");
  emit({ send: enabled ? "true" : "false" });
}

function maintenanceTaskCli() {
  const plan = maintenancePlan(process.env.EVENT_NAME ?? "", process.env.TASK ?? "");
  process.stdout.write(`${plan.task}\n`);
}

function maintenanceCommitCli() {
  const plan = maintenancePlan(process.env.EVENT_NAME ?? "", process.env.TASK ?? "");
  const dirty = plan.paths.filter((filePath) =>
    gitText(["status", "--porcelain", "--", filePath]).trim()
  );
  if (dirty.length === 0) {
    stderr("No changes to commit.");
    emit({ has_commit: "false" });
    return;
  }

  gitRun(["config", "user.name", "actions-bot"]);
  gitRun(["config", "user.email", "actions@github.com"]);
  gitRun(["add", "--", ...dirty]);
  gitRun(["-c", "commit.gpgsign=false", "commit", "-m", plan.message]);
  emit({ has_commit: "true" });
}

function emitRoute(sha, route, fromSha = "") {
  emit({
    run: route.run ? "true" : "false",
    board: route.board ? "true" : "false",
    notify: route.notify ? "true" : "false",
    from_sha: fromSha,
    data_sha: sha,
  });
}

function flag(value) {
  return value === "true";
}

function shouldStartCli() {
  const cancelled = process.env.CANCELLED === "true";
  const step = process.env.STEP ?? "";
  if (step === "notify") {
    const start = shouldNotify(
      process.env.BOARD ?? "success",
      process.env.NOTIFY === "true",
      process.env.SEND === "true",
      process.env.PREPARE ?? "success",
      cancelled
    );
    if (!start) {
      stderr(cancelled ? "Cancelled. Notification was not sent." : "Notification was not started.");
      process.exit(2);
    }
    return;
  }
  if (step === "write") {
    if (!shouldStartWrite(cancelled)) {
      stderr("Cancelled. No further writes.");
      process.exit(2);
    }
    return;
  }
  throw new Error(`unknown step ${step}`);
}

function batchConclusionCli() {
  const result = batchConclusion({
    checkpointPublish: process.env.CHECKPOINT_PUBLISH ?? "",
    collect: process.env.COLLECT ?? "",
    collectPublish: process.env.COLLECT_PUBLISH ?? "",
  });
  if (result === "cancelled") {
    stderr("Cancelled. No further writes.");
    return;
  }
  if (result === "failure") {
    stderr("Checkpoint publish failed after collect.");
    process.exit(1);
  }
}

function historyPlanCli() {
  const mode = process.env.MODE ?? "";
  if (mode === "commit") {
    const plan = commitHistoryPlan({
      shallow: flag(process.env.SHALLOW),
      commitPresent: flag(process.env.COMMIT_PRESENT),
      parentRequired: flag(process.env.PARENT_REQUIRED),
      parentPresent: flag(process.env.PARENT_PRESENT),
      fetched: flag(process.env.FETCHED),
    });
    process.stdout.write(`${plan}\n`);
    return;
  }
  if (mode === "rebase") {
    const plan = rebaseHistoryPlan({
      shallow: flag(process.env.SHALLOW),
      mergeBasePresent: flag(process.env.MERGE_BASE_PRESENT),
      unshallowed: flag(process.env.UNSHALLOWED),
    });
    process.stdout.write(`${plan}\n`);
    return;
  }
  throw new Error(`unknown history plan mode ${mode}`);
}

function readOptional(filePath) {
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, "utf8");
}

function main() {
  const command = process.argv[2] ?? "";
  const commands = {
    "jobs-gate": jobsGateCli,
    "batch-due": batchDueCli,
    "publish-route": publishRouteCli,
    "classify-head": classifyHeadCli,
    "notify-enabled": notifyEnabledCli,
    "maintenance-task": maintenanceTaskCli,
    "maintenance-commit": maintenanceCommitCli,
    "history-plan": historyPlanCli,
    "should-start": shouldStartCli,
    "batch-conclusion": batchConclusionCli,
  };
  const run = commands[command];
  if (!run) {
    stderr(`unknown command ${command}`);
    process.exit(1);
  }
  run();
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) main();
