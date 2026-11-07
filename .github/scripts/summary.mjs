/**
 * Run summary shared by the job workflows.
 *
 * Commands append one JSON object per stage. A workflow renders those records
 * once, after the work has finished. This file uses only Node built-ins so it
 * can run when dependency setup was skipped.
 */

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const STAGES = "stages.ndjson";
const WARNING =
  "::warning::Could not write the run summary. The task result is unchanged.\n";

const FIELDS = [
  ["status", "Status"],
  ["reason", "Reason"],
  ["from", "From"],
  ["to", "To"],
  ["companies", "Companies"],
  ["discovered", "Discovered"],
  ["slow", "Slow listings"],
  ["listingFailed", "Listing failures"],
  ["sources", "Sources"],
  ["fetched", "Fetched"],
  ["matched", "Matched"],
  ["received", "Processed"],
  ["jobsAdded", "Jobs added"],
  ["opportunitiesAdded", "Opportunities added"],
  ["opportunitiesUpdated", "Opportunities updated"],
  ["skipped", "Skipped"],
  ["skipReasons", "Skip reasons"],
  ["notificationSkipped", "Notification skipped"],
  ["filterReasons", "Notification filter"],
  ["reused", "Existing jobs reused"],
  ["failed", "Analysis failures"],
  ["batched", "Queued for batch"],
  ["notStarted", "Not started"],
  ["submitted", "Submitted"],
  ["realtime", "Analyzed now"],
  ["collected", "Collected"],
  ["replayed", "Replayed saved results"],
  ["jobsSaved", "Notification jobs"],
  ["queued", "Still queued"],
  ["inflight", "In flight"],
  ["retrying", "Retrying"],
  ["stopped", "Existing stopped failures"],
  ["pendingResults", "Pending replay"],
  ["requeued", "Requeued"],
  ["cost", "AI cost this pass"],
  ["candidates", "Jobs in range"],
  ["notifiedJobs", "Jobs notified"],
  ["messages", "Messages"],
  ["pages", "Category pages"],
  ["included", "Target opportunities"],
  ["committed", "Committed"],
  ["pushed", "Pushed"],
  ["kept", "Kept"],
  ["dropped", "Dropped"],
  ["unknown", "Unknown"],
  ["retries", "Retries"],
  ["urlsRemoved", "URLs removed"],
  ["opportunitiesRemoved", "Opportunities removed"],
  ["jobsRenamed", "Jobs renamed"],
  ["opportunitiesRenamed", "Opportunities renamed"],
  ["durationMs", "Duration"],
  ["elapsedMs", "Elapsed"],
  ["saved", "Written locally"],
];

const MEASURED = new Set(
  FIELDS.map(([key]) => key).filter((key) => !["status", "reason", "saved", "from", "to"].includes(key))
);

const QUEUE_KEYS = ["queued", "inflight", "retrying", "pendingResults"];
const PUBLISH_LABELS = [
  ["job data", "Data"],
  ["board", "Board"],
  ["batch checkpoint", "Checkpoint"],
  ["batch collect", "Batch data"],
  ["maintenance", "Maintenance"],
];

function warn() {
  process.stderr.write(WARNING);
}

function cell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("`", "'").replaceAll("\r", " ").replaceAll("\n", " ");
}

function formatValue(key, value) {
  if (value === null || value === undefined) return "unknown";
  if ((key === "durationMs" || key === "elapsedMs") && typeof value === "number") {
    return `${(value / 1000).toFixed(1)}s`;
  }
  if (key === "committed" || key === "pushed") {
    if (value === true) return "yes";
    if (value === false) return "no";
    return "unknown";
  }
  if (key === "skipReasons" || key === "filterReasons") {
    if (!value || typeof value !== "object") return "unknown";
    const parts = Object.entries(value)
      .filter(([, count]) => typeof count === "number")
      .map(([kind, count]) => `${kind} ${count}`);
    return parts.length > 0 ? parts.join(", ") : "none";
  }
  if (typeof value === "number" || typeof value === "string") return String(value);
  return "unknown";
}

function title(record) {
  if (record.stage === "jobs") return record.mode ? `Jobs (${record.mode})` : "Jobs";
  if (record.stage === "batch") return record.mode ? `Batch (${record.mode})` : "Batch";
  if (record.stage === "publish") return record.label ? `Publish (${record.label})` : "Publish";
  if (record.stage === "notify") return "Notify";
  if (record.stage === "commit") return record.label ? `Commit (${record.label})` : "Commit";
  if (record.stage === "push") return record.label ? `Push (${record.label})` : "Push";
  if (record.stage === "board") return "Board";
  if (record.stage === "board-commit") return "Board commit";
  if (record.stage === "recover") return "Batch recovery";
  if (record.stage === "maintenance") {
    return record.task ? `Maintenance (${record.task})` : "Maintenance";
  }
  if (record.stage === "maintenance-commit") {
    return record.task ? `Maintenance commit (${record.task})` : "Maintenance commit";
  }
  return "Stage";
}

function measured(record) {
  return FIELDS.some(([key]) => MEASURED.has(key) && record[key] !== undefined && record[key] !== null);
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatCost(value) {
  return String(Math.round(value * 1e10) / 1e10);
}

function eventId(record) {
  return typeof record.event === "string" && record.event.length > 0 ? record.event : null;
}

function countOnce(records) {
  const seen = new Set();
  const kept = [];

  for (const record of records) {
    const event = eventId(record);

    if (event) {
      if (seen.has(event)) continue;
      seen.add(event);
    }

    kept.push(record);
  }

  return kept;
}

function stampEvent(record) {
  if (eventId(record)) return record;
  return { ...record, event: randomUUID() };
}

function markdownTable(rows) {
  return ["| | |", "| --- | --- |", ...rows.map(([label, value]) => `| ${cell(label)} | ${cell(value)} |`)].join(
    "\n"
  );
}

function stageSection(record) {
  const rows = [];

  for (const [key, label] of FIELDS) {
    if (!Object.hasOwn(record, key)) continue;
    rows.push(`| ${cell(label)} | ${cell(formatValue(key, record[key]))} |`);
  }

  if (record.status === "failed" && !measured(record)) {
    const insertAt = rows.some((row) => row.startsWith("| Status ")) ? 1 : 0;
    rows.splice(insertAt, 0, "| Counts | unknown |");
  }

  const table =
    rows.length > 0
      ? ["| | |", "| --- | --- |", ...rows].join("\n")
      : ["| | |", "| --- | --- |", "| Status | unknown |"].join("\n");

  return `### ${cell(title(record))}\n\n${table}`;
}

function completeSnapshot(record) {
  if (record.stage !== "batch" && record.stage !== "recover") return null;
  if (record.status === "failed" || record.status === "skipped") return null;

  const snapshot = {};

  for (const key of QUEUE_KEYS) {
    const value = numberOrNull(record[key]);

    if (value === null) return null;

    snapshot[key] = value;
  }

  return snapshot;
}

function queueReport(records) {
  let last = null;
  let interrupted = false;
  const seen = new Set();

  for (const record of records) {
    const event = eventId(record);

    if (event) {
      if (seen.has(event)) continue;
      seen.add(event);
    }

    const snapshot = completeSnapshot(record);

    if (snapshot) {
      last = snapshot;
      interrupted = false;
      continue;
    }

    if (record.stage === "batch" && record.status === "failed") {
      interrupted = true;
    }
  }

  if (!last) {
    return records.some((record) => record.stage === "batch" && record.status === "failed")
      ? { kind: "unknown" }
      : { kind: "none" };
  }

  if (interrupted) return { kind: "last", snapshot: last };

  return {
    kind: QUEUE_KEYS.some((key) => last[key] > 0) ? "waiting" : "clear",
    snapshot: last,
  };
}

function queueText(snapshot) {
  return QUEUE_KEYS.filter((key) => snapshot[key] > 0)
    .map((key) => `${key} ${snapshot[key]}`)
    .join(", ");
}

function latestJobs(records) {
  const byMode = new Map();

  for (const record of countOnce(records)) {
    if (record.stage !== "jobs" || record.status === "skipped") continue;
    byMode.set(record.mode || "", record);
  }

  return [...byMode.values()];
}

function jobsLine(record) {
  const parts = [];
  const companies = numberOrNull(record.companies);
  const received = numberOrNull(record.received);
  const discovered = numberOrNull(record.discovered);

  if (companies !== null) parts.push(`${companies} companies`);
  if (received !== null) parts.push(`${received} candidates`);
  else if (discovered !== null) parts.push(`${discovered} discovered`);

  const skipped = numberOrNull(record.skipped);
  if (skipped !== null && skipped > 0) parts.push(`${skipped} skipped`);

  const batched = numberOrNull(record.batched);
  if (batched !== null && batched > 0) parts.push(`${batched} queued for batch`);

  const listingFailed = numberOrNull(record.listingFailed);
  if (listingFailed !== null && listingFailed > 0) parts.push(`${listingFailed} listing failures`);

  const failed = numberOrNull(record.failed);
  if (failed !== null && failed > 0) parts.push(`${failed} analysis failures`);

  const notStarted = numberOrNull(record.notStarted);
  if (notStarted !== null && notStarted > 0) parts.push(`${notStarted} not started`);

  return parts.join(", ") || "recorded";
}

function reasonCounts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter(([, count]) => typeof count === "number" && count > 0)
  );
}

function batchTotals(records) {
  const totals = {
    count: 0,
    collected: 0,
    realtime: 0,
    replayed: 0,
    jobsSaved: 0,
    reused: 0,
    opportunitiesAdded: 0,
    opportunitiesUpdated: 0,
    failed: 0,
    hasCollected: false,
    hasRealtime: false,
    hasReplayed: false,
    hasJobsSaved: false,
    cost: 0,
    costKnown: true,
    sawCost: false,
    filterReasons: {},
    incomplete: false,
  };

  for (const record of countOnce(records)) {
    if (record.stage !== "batch" || record.status === "skipped") continue;

    if (record.status === "failed") {
      totals.incomplete = true;
      const cost = numberOrNull(record.cost);

      if (cost === null) totals.costKnown = false;
      else {
        totals.cost += cost;
        totals.sawCost = true;
      }

      continue;
    }

    totals.count += 1;
    const collected = numberOrNull(record.collected);

    if (collected !== null) {
      totals.collected += collected;
      totals.hasCollected = true;
    }

    const realtime = numberOrNull(record.realtime);

    if (realtime !== null) {
      totals.realtime += realtime;
      totals.hasRealtime = true;
    }

    const replayed = numberOrNull(record.replayed);

    if (replayed !== null) {
      totals.replayed += replayed;
      totals.hasReplayed = true;
    }

    const jobsSaved = numberOrNull(record.jobsSaved);

    if (jobsSaved !== null) {
      totals.jobsSaved += jobsSaved;
      totals.hasJobsSaved = true;
    }

    const reused = numberOrNull(record.reused);
    if (reused !== null) totals.reused += reused;

    const opportunitiesAdded = numberOrNull(record.opportunitiesAdded);
    if (opportunitiesAdded !== null) totals.opportunitiesAdded += opportunitiesAdded;

    const opportunitiesUpdated = numberOrNull(record.opportunitiesUpdated);
    if (opportunitiesUpdated !== null) totals.opportunitiesUpdated += opportunitiesUpdated;

    const failed = numberOrNull(record.failed);
    if (failed !== null) totals.failed += failed;

    const cost = numberOrNull(record.cost);

    if (cost === null) {
      totals.costKnown = false;
    } else {
      totals.cost += cost;
      totals.sawCost = true;
    }

    for (const [kind, count] of Object.entries(reasonCounts(record.filterReasons))) {
      totals.filterReasons[kind] = (totals.filterReasons[kind] ?? 0) + count;
    }
  }

  return totals;
}

function batchLine(totals) {
  if (totals.count === 0 && totals.incomplete) return "did not finish; counts unknown";

  const parts = [];

  if (totals.hasRealtime) parts.push(`${totals.realtime} analyzed now`);
  if (totals.hasCollected) parts.push(`${totals.collected} collected`);
  if (totals.hasReplayed) parts.push(`${totals.replayed} replayed`);

  const filters = Object.entries(totals.filterReasons);
  const filterText = filters.map(([kind, count]) => `${kind} ${count}`).join(", ");

  if (totals.hasJobsSaved && totals.jobsSaved === 0 && filterText) {
    parts.push(`no notification job; filter ${filterText}`);
  } else if (totals.hasJobsSaved) {
    const saved = totals.jobsSaved === 1 ? "1 notification job" : `${totals.jobsSaved} notification jobs`;
    parts.push(saved);
    if (filterText) parts.push(`filter ${filterText}`);
  }

  if (totals.reused > 0) {
    parts.push(`reused ${totals.reused} existing ${totals.reused === 1 ? "job" : "jobs"}`);
  }
  if (totals.failed > 0) parts.push(`${totals.failed} newly stopped`);
  if (totals.incomplete) parts.push("a later collect did not finish");

  return parts.join("; ") || "recorded";
}

function pushOutcome(records, label) {
  const pushes = records.filter((record) => record.stage === "push" && (record.label || "push") === label);

  if (pushes.length === 0) return null;

  const rejected = (record) => record.pushed === false || record.status === "failed";
  const pushed = (record) => record.pushed === true && record.status !== "failed";
  const last = pushes.at(-1);

  if (rejected(last)) return "push rejected";
  if (pushes.slice(0, -1).some(rejected) && pushed(last)) return "push rejected; a later push succeeded";
  if (pushed(last)) return "pushed";
  return "unknown";
}

function commitOutcome(records, label) {
  const commits = records.filter((record) => record.stage === "commit" && record.label === label);

  if (label === "board") {
    commits.push(...records.filter((record) => record.stage === "board-commit"));
  }

  if (label === "maintenance") {
    commits.push(...records.filter((record) => record.stage === "maintenance-commit"));
  }

  if (commits.length === 0) return null;
  if (commits.some((record) => record.committed === true)) return "committed locally";
  if (commits.some((record) => record.committed === false)) return "unchanged";
  return null;
}

function describePublish(records, label) {
  const push = pushOutcome(records, label);
  const commit = commitOutcome(records, label);

  if (push === "push rejected" && commit === "committed locally") return "committed locally, push rejected";
  if (push) return push;
  if (commit) return commit;
  return null;
}

function publishRows(records) {
  const rows = [];
  const described = new Map(
    PUBLISH_LABELS.map(([label, title]) => [label, { title, text: describePublish(records, label) }])
  );
  const data = described.get("job data");
  const board = described.get("board");
  const boardFailed = records.some((record) => record.stage === "board" && record.status === "failed");

  if (data?.text === "pushed" && board?.text === "pushed" && !boardFailed) {
    rows.push(["Data and board", "pushed"]);
  } else {
    if (data?.text) rows.push([data.title, data.text]);
    if (boardFailed && board?.text === "pushed") rows.push(["Board", "refresh failed; a later push succeeded"]);
    else if (boardFailed && board?.text) rows.push(["Board", `refresh failed; ${board.text}`]);
    else if (boardFailed) rows.push(["Board", "refresh failed"]);
    else if (board?.text) rows.push([board.title, board.text]);
  }

  for (const [label, title] of PUBLISH_LABELS) {
    if (label === "job data" || label === "board") continue;

    const text = described.get(label)?.text;
    if (text) rows.push([title, text]);
  }

  const recoveryPush = pushOutcome(records, "batch recovery");
  const recovery = [...records].reverse().find((record) => record.stage === "recover");

  if (recovery || recoveryPush) {
    if (recovery?.committed === true && recoveryPush === "push rejected") {
      rows.push(["Recovery", "committed locally, push rejected"]);
    } else if (recovery?.committed === true && recoveryPush === "pushed") {
      rows.push(["Recovery", "committed and pushed"]);
    } else if (recovery?.committed === true) {
      rows.push(["Recovery", recoveryPush ?? "committed locally"]);
    } else if (recovery?.committed === false) {
      rows.push(["Recovery", "unchanged"]);
    } else if (recovery?.status === "failed") {
      rows.push(["Recovery", "failed"]);
    } else if (recoveryPush) {
      rows.push(["Recovery", recoveryPush]);
    }
  }

  return rows;
}

function jobsNotified(count) {
  return count === 1 ? "1 job notified" : `${count} jobs notified`;
}

function notifyReason(record) {
  if (record.reason === "notifications disabled") return "disabled";
  if (record.reason === "no new jobs") return "no new notification jobs";
  if (record.reason === "could not read the job diff") return "did not run; the job diff could not be read";
  if (record.reason === "notification was not requested") return "not requested";
  if (record.reason === "an earlier step failed before notification") {
    return "did not run because an earlier step failed";
  }
  if (record.reason === "notifications were not sent") return "not sent";
  if (record.notifiedJobs === 0) return "no new notification jobs";
  if (typeof record.notifiedJobs === "number") return jobsNotified(record.notifiedJobs);
  return record.reason || record.status || "unknown";
}

function notifyRangesAreDisjoint(records) {
  if (records.length <= 1) return true;
  if (records.some((record) => typeof record.from !== "string" || typeof record.to !== "string" || record.from === record.to)) {
    return false;
  }

  const next = new Map();
  const ends = new Set();

  for (const record of records) {
    if (next.has(record.from) || ends.has(record.to)) return false;
    next.set(record.from, record.to);
    ends.add(record.to);
  }

  const heads = [...next.keys()].filter((from) => !ends.has(from));
  if (heads.length !== 1) return false;

  let cursor = heads[0];
  let seen = 0;
  const visited = new Set();

  while (next.has(cursor)) {
    if (visited.has(cursor)) return false;
    visited.add(cursor);
    cursor = next.get(cursor);
    seen += 1;
  }

  return seen === records.length;
}

function notifyText(records) {
  const notes = countOnce(records.filter((record) => record.stage === "notify"));

  if (notes.length === 0) return null;

  const ran = notes.filter((record) => record.status !== "skipped");
  const skipped = notes.filter((record) => record.status === "skipped");

  if (ran.length === 0) {
    return [...new Set(skipped.map(notifyReason))].join("; ");
  }

  const stopped = ran.some((record) => record.status === "failed" || record.messages === "unknown");
  const counted = ran.filter((record) => typeof record.notifiedJobs === "number");
  let text;

  if (counted.length === 0) {
    text = [...new Set(ran.map(notifyReason))].join("; ");
  } else if (counted.length === 1) {
    text = notifyReason(counted[0]);
  } else if (notifyRangesAreDisjoint(counted)) {
    const total = counted.reduce((sum, record) => sum + record.notifiedJobs, 0);
    text = total === 0 ? "no new notification jobs" : jobsNotified(total);
  } else {
    text = `notification completions ${counted.map((record) => record.notifiedJobs).join(" + ")}`;
  }

  if (stopped && !text.includes("some messages may already have been sent")) {
    text = `${text}; notification stopped; some messages may already have been sent`;
  }

  return text;
}

function existingStopped(records) {
  let value = null;
  const seen = new Set();

  for (const record of records) {
    const event = eventId(record);

    if (event) {
      if (seen.has(event)) continue;
      seen.add(event);
    }

    if (record.stage !== "batch" || record.status === "failed") continue;

    const stopped = numberOrNull(record.stopped);
    if (stopped !== null) value = stopped;
  }

  return value;
}

function workflowKind(records) {
  if (records.some((record) => record.stage === "jobs")) return "jobs";
  if (records.some((record) => record.stage === "batch" || record.stage === "recover")) return "batch";
  if (records.some((record) => record.stage === "maintenance" || record.stage === "maintenance-commit")) {
    return "maintenance";
  }
  return "publish";
}

function maintenanceRows(records) {
  const rows = [];
  const seen = new Set();

  for (const record of countOnce(records)) {
    if (record.stage !== "maintenance") continue;

    const task = record.task || "Maintenance";
    if (seen.has(task)) continue;
    seen.add(task);

    const parts = [];

    for (const [key, label] of [
      ["kept", "kept"],
      ["dropped", "dropped"],
      ["unknown", "unknown"],
      ["retries", "retries"],
      ["urlsRemoved", "URLs removed"],
      ["opportunitiesRemoved", "opportunities removed"],
      ["jobsRenamed", "jobs renamed"],
      ["opportunitiesRenamed", "opportunities renamed"],
    ]) {
      const value = numberOrNull(record[key]);
      if (value !== null) parts.push(`${label} ${value}`);
    }

    rows.push([task, parts.join(", ") || record.status || "recorded"]);
  }

  return rows;
}

function outcomeRows(records, result) {
  const rows = [["Result", result]];
  const jobs = latestJobs(records);
  const totals = batchTotals(records);
  const queue = queueReport(records);
  const kind = workflowKind(records);

  if (kind === "jobs") {
    for (const record of jobs) {
      const mode = record.mode ? `${record.mode[0].toUpperCase()}${record.mode.slice(1)}` : "Jobs";
      rows.push([mode, jobsLine(record)]);

      const opportunities = numberOrNull(record.opportunitiesAdded);
      if (opportunities !== null) rows.push(["Opportunities added", String(opportunities)]);

      const notificationJobs = numberOrNull(record.jobsAdded);
      if (notificationJobs !== null) rows.push(["Notification jobs", String(notificationJobs)]);
    }
  }

  if (kind === "batch" || totals.count > 0 || totals.incomplete) {
    rows.push(["Batch", batchLine(totals)]);

    if (totals.opportunitiesAdded > 0) rows.push(["Batch opportunities", String(totals.opportunitiesAdded)]);
    if (totals.opportunitiesUpdated > 0) {
      rows.push(["Opportunities updated", String(totals.opportunitiesUpdated)]);
    }
  }

  if (kind === "maintenance") rows.push(...maintenanceRows(records));

  rows.push(...publishRows(records));

  const notifications = notifyText(records);
  if (notifications) rows.push(["Notifications", notifications]);

  if (queue.kind === "clear") rows.push(["Still waiting", "none"]);
  else if (queue.kind === "waiting") rows.push(["Still waiting", queueText(queue.snapshot)]);
  else if (queue.kind === "last") {
    const text = queueText(queue.snapshot);
    rows.push([
      "Still waiting",
      text ? `last confirmed: ${text}; final state unknown` : "last confirmed: none; final state unknown",
    ]);
  } else if (queue.kind === "unknown") {
    rows.push(["Still waiting", "unknown"]);
  }

  const stopped = existingStopped(records);
  if (stopped !== null && stopped > 0) rows.push(["Existing stopped failures", String(stopped)]);

  if (totals.count > 0 || totals.incomplete) {
    if (!totals.costKnown) rows.push(["AI cost", "unknown"]);
    else if (totals.sawCost) rows.push(["AI cost", formatCost(totals.cost)]);
  }

  return { rows, totals, queue };
}

function outcomeLead(records, result, rows) {
  const sentences = [];

  if (result === "failed") sentences.push("This run failed.");
  else if (result === "cancelled") sentences.push("This run was cancelled.");
  else if (records.length === 0) {
    return "No stage recorded a result. This summary does not mean the run succeeded.";
  } else sentences.push("This run succeeded.");

  for (const record of latestJobs(records)) {
    const mode = record.mode ? `${record.mode[0].toUpperCase()}${record.mode.slice(1)}` : "Jobs";
    const received = numberOrNull(record.received);
    sentences.push(
      received === null ? `${mode} finished.` : `${mode} finished and processed ${received} candidates.`
    );

    const opportunities = numberOrNull(record.opportunitiesAdded);
    if (opportunities !== null) sentences.push(`${opportunities} opportunities were added.`);
  }

  const batch = rows.find(([label]) => label === "Batch");
  if (batch) sentences.push(`Batch: ${batch[1]}.`);

  const published = rows.find(([label]) => label === "Data and board" || label === "Data" || label === "Board");
  if (published) sentences.push(`${published[0]}: ${published[1]}.`);

  const waiting = rows.find(([label]) => label === "Still waiting");
  if (waiting?.[1] === "none") sentences.push("No batches are waiting.");
  else if (waiting) sentences.push(`Still waiting: ${waiting[1]}.`);

  const notifications = rows.find(([label]) => label === "Notifications");
  if (notifications) sentences.push(`Notifications: ${notifications[1]}.`);

  return sentences.join(" ");
}

export function renderMarkdown(records, options = {}) {
  const jobStatus = options.jobStatus || "";
  const stageFailed = records.some((record) => record.status === "failed");
  const jobFailed =
    jobStatus === "failure" ||
    (jobStatus !== "success" && jobStatus !== "cancelled" && stageFailed);
  const result = jobStatus === "cancelled" ? "cancelled" : jobFailed ? "failed" : "success";
  const outcome = records.length === 0 ? { rows: [], totals: batchTotals([]), queue: { kind: "none" } } : outcomeRows(records, result);

  if (jobStatus === "failure" && !stageFailed) {
    outcome.rows.splice(1, 0, ["Failed stage", "unknown"]);
  }

  const notes = [];

  if (jobStatus === "cancelled") {
    notes.push(
      "This run was cancelled. The tables only include stages that recorded a result before cancellation."
    );
  } else if (jobFailed) {
    notes.push(
      "This run failed. The tables show which stages finished. Data is on the remote only when a push table says yes. Writing this summary does not change that result."
    );
  } else if (records.some((record) => record.status === "partial")) {
    notes.push("Listing or analysis was incomplete. Counts are only the work that finished.");
  }

  if (outcome.totals.failed > 0) {
    notes.push(
      `This run stopped ${outcome.totals.failed} batch ${outcome.totals.failed === 1 ? "analysis" : "analyses"}.`
    );
  }

  if (outcome.queue.kind === "waiting") {
    notes.push("Queued, in-flight, retrying, or pending results can run again later.");
  } else if (outcome.queue.kind === "last" || outcome.queue.kind === "unknown") {
    notes.push("Collection did not finish. The final queue state is unknown.");
  }

  const details = records.map(stageSection);

  if (jobStatus === "failure" && !stageFailed) {
    details.unshift(
      ["### Run", "", "| | |", "| --- | --- |", "| Status | failed |", "| Failed stage | unknown |"].join("\n")
    );
  }

  return [
    "## Run summary",
    "",
    outcomeLead(records, result, outcome.rows),
    "",
    outcome.rows.length > 0 ? markdownTable(outcome.rows) : "",
    "",
    notes.length > 0 ? `${notes.join("\n\n")}\n` : "",
    "<details>",
    "<summary>執行細節</summary>",
    "",
    "Stages that did not run are omitted. A shown 0 was measured. Unknown means the stage did not report that number.",
    "",
    details.join("\n\n"),
    "",
    "</details>",
    "",
  ].join("\n");
}

export function readStages(dir) {
  const file = path.join(dir, STAGES);
  if (!existsSync(file)) return [];

  return readFileSync(file, "utf8")
    .split(/\n/)
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        const value = JSON.parse(line);
        return value && typeof value === "object" && !Array.isArray(value) ? [value] : [];
      } catch {
        warn();
        return [];
      }
    });
}

export function appendStage(record) {
  const dir = process.env.JOBRADAR_SUMMARY_DIR;
  if (!dir || !record || typeof record !== "object" || Array.isArray(record)) return false;

  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, STAGES), `${JSON.stringify(stampEvent(record))}\n`);
    return true;
  } catch {
    warn();
    return false;
  }
}

export function renderSummary(options = {}) {
  const dir = options.dir ?? process.env.JOBRADAR_SUMMARY_DIR;
  const summaryPath = options.summaryPath ?? process.env.GITHUB_STEP_SUMMARY;
  let records = [];

  if (dir) {
    try {
      records = readStages(dir);
    } catch {
      warn();
    }
  }

  const jobStatus = options.jobStatus ?? process.env.JOB_STATUS;
  const markdown = renderMarkdown(records, { jobStatus });
  if (!summaryPath) {
    warn();
    return { wrote: false, markdown };
  }

  try {
    appendFileSync(summaryPath, markdown.endsWith("\n") ? markdown : `${markdown}\n`);
    return { wrote: true, markdown };
  } catch {
    warn();
    return { wrote: false, markdown };
  }
}

function appendRange() {
  const record = {
    stage: "publish",
    label: process.env.PUBLISH_LABEL || "saved data",
  };
  if (process.env.FROM_SHA) record.from = process.env.FROM_SHA;
  if (process.env.DATA_SHA) record.to = process.env.DATA_SHA;
  appendStage(record);
}

function appendRecover() {
  const status = Number(process.env.RECOVER_STATUS);
  const line = (process.env.RECOVER_OUTPUT ?? "")
    .split(/\n/)
    .find((item) => item.startsWith("committed="));
  const record = {
    stage: "recover",
    status: status === 0 ? "success" : "failed",
    saved: "unknown",
  };

  if (line === "committed=true") {
    record.committed = true;
    record.saved = "local";
  } else if (line === "committed=false") {
    record.committed = false;
    record.saved = status === 0 ? "unchanged" : "unknown";
  } else {
    record.saved = "unknown";
  }

  appendStage(record);
}

function appendCommit() {
  appendStage({
    stage: "commit",
    label: process.env.COMMIT_LABEL || "commit",
    status: "success",
    committed: true,
  });
}

function appendPush() {
  const ok = process.env.PUSH_STATUS === "success";
  const record = {
    stage: "push",
    label: process.env.PUSH_LABEL || "push",
    status: ok ? "success" : "failed",
    pushed: ok,
  };
  if (!ok) record.reason = "push did not succeed";
  appendStage(record);
}

function main() {
  const command = process.argv[2];

  if (command === "append") {
    try {
      appendStage(JSON.parse(process.argv[3] ?? "null"));
    } catch {
      warn();
    }
    return;
  }

  if (command === "append-range") {
    appendRange();
    return;
  }

  if (command === "append-recover") {
    appendRecover();
    return;
  }

  if (command === "append-commit") {
    appendCommit();
    return;
  }

  if (command === "append-push") {
    appendPush();
    return;
  }

  if (command === "render") {
    renderSummary();
    return;
  }

  warn();
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) main();
