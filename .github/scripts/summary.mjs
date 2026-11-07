/**
 * Run summary shared by the job workflows.
 *
 * Commands append one JSON object per stage. A workflow renders those records
 * once, after the work has finished. This file uses only Node built-ins so it
 * can run when dependency setup was skipped.
 */

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
  ["skipped", "Skipped"],
  ["skipReasons", "Skip reasons"],
  ["failed", "Analysis failures"],
  ["batched", "Queued for batch"],
  ["notStarted", "Not started"],
  ["submitted", "Submitted"],
  ["collected", "Collected"],
  ["jobsSaved", "Jobs saved"],
  ["persistSkipped", "Not persisted"],
  ["queued", "Still queued"],
  ["inflight", "In flight"],
  ["retrying", "Retrying"],
  ["stopped", "Stopped"],
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

const REMAINING = ["queued", "inflight", "retrying", "pendingResults", "notStarted", "requeued"];

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
  if (key === "skipReasons") {
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

export function renderMarkdown(records, options = {}) {
  const jobStatus = options.jobStatus || "";
  const sections = records.map((record) => {
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
  });

  const stageFailed = records.some((record) => record.status === "failed");
  const jobFailed =
    jobStatus === "failure" ||
    (jobStatus !== "success" && jobStatus !== "cancelled" && stageFailed);
  if (jobStatus === "failure" && !stageFailed) {
    sections.unshift(
      ["### Run", "", "| | |", "| --- | --- |", "| Status | failed |", "| Failed stage | unknown |"].join(
        "\n"
      )
    );
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
  } else if (records.length === 0) {
    notes.push("No stage recorded a result. This summary does not mean the run succeeded.");
  } else if (records.some((record) => record.status === "partial")) {
    notes.push("Part of this run failed. Counts are only the work that finished.");
  }
  if (records.some((record) => REMAINING.some((key) => Number(record[key]) > 0))) {
    notes.push(
      "Queued, in-flight, retrying, pending replay, or not-started work can run again later."
    );
  }

  return [
    "## Run summary",
    "",
    "Stages that did not run are omitted. A shown 0 was measured. Unknown means the stage did not report that number.",
    "",
    sections.join("\n\n"),
    "",
    notes.length > 0 ? `${notes.join("\n\n")}\n` : "",
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
    appendFileSync(path.join(dir, STAGES), `${JSON.stringify(record)}\n`);
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
