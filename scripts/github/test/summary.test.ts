import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { appendStage, renderMarkdown, renderSummary } from "@github/scripts/summary.mjs";

import { recordStage } from "../summary";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const SUMMARY = path.join(ROOT, ".github/scripts/summary.mjs");
const temps: string[] = [];

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "jobradar-summary-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  delete process.env.JOBRADAR_SUMMARY_DIR;
  delete process.env.GITHUB_STEP_SUMMARY;
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("run summary", () => {
  it("shows measured zeros for finished work and omits counts when a stage is skipped", () => {
    const markdown = renderMarkdown([
      {
        stage: "jobs",
        mode: "scan",
        status: "success",
        discovered: 0,
        jobsAdded: 0,
        opportunitiesAdded: 0,
        skipped: 0,
        failed: 0,
        batched: 0,
        saved: "complete",
      },
      {
        stage: "jobs",
        status: "skipped",
        reason: "outside the scan window",
      },
    ]);

    expect(markdown).toContain("### Jobs (scan)");
    expect(markdown).toContain("| Discovered | 0 |");
    expect(markdown).toContain("| Jobs added | 0 |");
    expect(markdown).toContain("| Status | success |");
    expect(markdown).toContain("### Jobs\n\n| | |\n| --- | --- |\n| Status | skipped |");
    expect(markdown).toContain("| Reason | outside the scan window |");
    expect(markdown).not.toContain("This run failed");
    const skipped = markdown.slice(markdown.indexOf("### Jobs\n"));
    expect(skipped).not.toContain("Discovered");
    expect(skipped).not.toContain("| 0 |");
  });

  it("keeps a partial analysis distinct from jobs added and from mail", () => {
    const markdown = renderMarkdown([
      {
        stage: "jobs",
        mode: "sync",
        status: "partial",
        fetched: 4,
        matched: 3,
        received: 3,
        jobsAdded: 1,
        opportunitiesAdded: 2,
        skipped: 1,
        skipReasons: { filter: 1 },
        failed: 1,
        batched: 1,
        notStarted: 0,
        saved: "complete",
      },
    ]);

    expect(markdown).toContain("| Fetched | 4 |");
    expect(markdown).toContain("| Matched | 3 |");
    expect(markdown).toContain("| Processed | 3 |");
    expect(markdown).toContain("| Jobs added | 1 |");
    expect(markdown).toContain("| Opportunities added | 2 |");
    expect(markdown).toContain("| Queued for batch | 1 |");
    expect(markdown).toContain("| Analysis failures | 1 |");
    expect(markdown).toContain("| Skip reasons | filter 1 |");
    expect(markdown).toContain("Listing or analysis was incomplete");
    expect(markdown).not.toContain("Part of this run failed");
    expect(markdown).not.toContain("Emails sent");
  });

  it("shows a failed board and a successful notification as separate stages", () => {
    const markdown = renderMarkdown([
      { stage: "board", status: "failed", reason: "board refresh failed", saved: "unknown" },
      {
        stage: "notify",
        status: "success",
        from: "a".repeat(40),
        to: "b".repeat(40),
        candidates: 2,
        notifiedJobs: 2,
        saved: "unchanged",
      },
    ]);

    const head = markdown.slice(0, markdown.indexOf("<details>"));
    expect(head).toContain("| Result | failed |");
    expect(head).toContain("| Board | refresh failed |");
    expect(head).toContain("| Notifications | 2 jobs notified |");
    expect(head).not.toContain("### ");
    expect(markdown).toContain("### Board");
    expect(markdown).toContain("| Status | failed |");
    expect(markdown).toContain("### Notify");
    expect(markdown).toContain("| Jobs notified | 2 |");
    expect(markdown).not.toContain("Emails sent");
    expect(markdown).toContain("| Jobs in range | 2 |");
    expect(markdown).toContain("This run failed");
    expect(markdown.indexOf("### Board")).toBeLessThan(markdown.indexOf("### Notify"));
  });

  it("shows an unknown failed stage when the job failed without a failed record", () => {
    const dir = tempDir();
    const stageDir = path.join(dir, "stages");
    const rendered = path.join(dir, "summary.md");
    const appended = spawnSync(
      process.execPath,
      [SUMMARY, "append", JSON.stringify({ stage: "jobs", mode: "scan", status: "success", jobsAdded: 1, saved: "complete" })],
      {
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          JOBRADAR_SUMMARY_DIR: stageDir,
        },
      }
    );
    expect(appended.status).toBe(0);

    const result = spawnSync(process.execPath, [SUMMARY, "render"], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        JOBRADAR_SUMMARY_DIR: stageDir,
        GITHUB_STEP_SUMMARY: rendered,
        JOB_STATUS: "failure",
      },
    });
    expect(result.status).toBe(0);
    const markdown = readFileSync(rendered, "utf8");
    expect(markdown).toContain("### Run");
    expect(markdown).toContain("| Failed stage | unknown |");
    expect(markdown).toContain("### Jobs (scan)");
    expect(markdown).toContain("| Status | success |");
    expect(markdown).toContain("| Jobs added | 1 |");
    expect(markdown).toContain("This run failed");
    expect(markdown).not.toContain("push did not succeed");
  });

  it("does not call a successful job failed because one stage is partial", () => {
    const markdown = renderMarkdown(
      [{ stage: "jobs", mode: "scan", status: "partial", listingFailed: 1, failed: 0, saved: "complete" }],
      { jobStatus: "success" }
    );

    expect(markdown).toContain("| Status | partial |");
    expect(markdown).toContain("Listing or analysis was incomplete");
    expect(markdown).not.toContain("Part of this run failed");
    expect(markdown).not.toContain("This run failed");
    expect(markdown).not.toContain("Failed stage");
  });

  it("keeps a saved checkpoint visible when collect fails", () => {
    const markdown = renderMarkdown([
      { stage: "publish", label: "batch checkpoint", to: "c".repeat(40) },
      { stage: "batch", mode: "collect", status: "failed", reason: "batch failed", saved: "unknown" },
      { stage: "recover", status: "success", committed: true, saved: "local" },
      { stage: "push", label: "batch recovery", status: "failed", pushed: false, reason: "push did not succeed" },
    ]);

    expect(markdown).toContain("### Publish (batch checkpoint)");
    expect(markdown).toContain(`| To | ${"c".repeat(40)} |`);
    expect(markdown).toContain("### Batch (collect)");
    expect(markdown).toContain("| Counts | unknown |");
    expect(markdown).toContain("### Batch recovery");
    expect(markdown).toContain("| Committed | yes |");
    expect(markdown).toContain("| Written locally | local |");
    expect(markdown).toContain("| Committed | yes |");
    expect(markdown).toContain("| Pushed | no |");
    expect(markdown).not.toContain("| Pushed | yes |");
    expect(markdown).toContain("This run failed");
  });

  it("does not add AI cost across passes", () => {
    const markdown = renderMarkdown([
      { stage: "batch", mode: "collect", status: "success", cost: 0.003, jobsSaved: 2, collected: 2 },
      { stage: "batch", mode: "collect", status: "success", cost: 0, jobsSaved: 0, collected: 0 },
    ]);

    expect(markdown.match(/AI cost this pass/g)).toHaveLength(2);
    expect(markdown).toContain("| AI cost this pass | 0.003 |");
    expect(markdown).toContain("| AI cost this pass | 0 |");
    expect(markdown).not.toContain("0.006");
    expect(markdown).not.toContain("Total");
  });

  it("escapes external text and leaves secrets out of the table", () => {
    const markdown = renderMarkdown([
      {
        stage: "publish",
        label: "direct push",
        status: "failed",
        reason: "bad | pipe\n## Injected\n`token`",
        saved: "unchanged",
      },
    ]);

    expect(markdown).toContain("bad \\| pipe ## Injected 'token'");
    expect(markdown).not.toMatch(/\n## Injected/);
    expect(markdown).not.toContain("super-secret");
    expect(markdown).not.toContain("SMTP_PASS");
  });

  it("does not change the task result when the summary file cannot be written", () => {
    const dir = tempDir();
    const blocked = path.join(dir, "not-a-directory");
    writeFileSync(blocked, "kept");
    process.env.JOBRADAR_SUMMARY_DIR = blocked;
    const stderr: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    let result: { saved: boolean };
    try {
      result = (() => {
        recordStage({ stage: "jobs", mode: "scan", status: "success", jobsAdded: 3 });
        return { saved: true };
      })();
    } finally {
      process.stderr.write = write;
    }

    expect(result).toEqual({ saved: true });
    expect(readFileSync(blocked, "utf8")).toBe("kept");
    expect(stderr.join("")).toContain("The task result is unchanged");

    const stages = path.join(dir, "stages");
    mkdirSync(stages);
    writeFileSync(path.join(stages, "stages.ndjson"), '{"stage":"jobs","status":"success","jobsAdded":1}\n');
    const summaryDir = path.join(dir, "summary-dir");
    mkdirSync(summaryDir);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    let rendered: ReturnType<typeof renderSummary>;
    try {
      rendered = renderSummary({ dir: stages, summaryPath: summaryDir });
    } finally {
      process.stderr.write = write;
    }
    expect(rendered.wrote).toBe(false);
    expect(rendered.markdown).toContain("| Jobs added | 1 |");
    expect(stderr.join("")).toContain("The task result is unchanged");
    expect(readFileSync(path.join(stages, "stages.ndjson"), "utf8")).toContain('"jobsAdded":1');
  });

  it("appends stage records without touching the official summary file", () => {
    const dir = tempDir();
    const official = path.join(dir, "official.md");
    const stageDir = path.join(dir, "stages");
    writeFileSync(official, "OFFICIAL\n");
    process.env.GITHUB_STEP_SUMMARY = official;
    process.env.JOBRADAR_SUMMARY_DIR = stageDir;

    expect(appendStage({ stage: "maintenance", task: "clean", status: "success", kept: 4, dropped: 1, unknown: 0, retries: 2, elapsedMs: 1500, saved: "complete" })).toBe(true);
    expect(readFileSync(official, "utf8")).toBe("OFFICIAL\n");

    const rendered = path.join(dir, "rendered.md");
    const result = renderSummary({ dir: stageDir, summaryPath: rendered });
    expect(result.wrote).toBe(true);
    expect(readFileSync(rendered, "utf8")).toContain("| Kept | 4 |");
    expect(readFileSync(rendered, "utf8")).toContain("| Dropped | 1 |");
    expect(readFileSync(rendered, "utf8")).toContain("| Unknown | 0 |");
    expect(readFileSync(rendered, "utf8")).toContain("| Retries | 2 |");
    expect(readFileSync(rendered, "utf8")).toContain("| Elapsed | 1.5s |");
    expect(readFileSync(official, "utf8")).toBe("OFFICIAL\n");
  });

  it("records recovery from the command output and still exits 0 when rendering fails", () => {
    const dir = tempDir();
    const official = path.join(dir, "official.md");
    const stageDir = path.join(dir, "stages");
    writeFileSync(official, "OFFICIAL\n");
    const failed = spawnSync(process.execPath, [SUMMARY, "append-recover"], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        JOBRADAR_SUMMARY_DIR: stageDir,
        GITHUB_STEP_SUMMARY: official,
        RECOVER_STATUS: "1",
        RECOVER_OUTPUT: "committed=true\n",
      },
    });
    expect(failed.status).toBe(0);
    expect(readFileSync(official, "utf8")).toBe("OFFICIAL\n");
    const stage = readFileSync(path.join(stageDir, "stages.ndjson"), "utf8");
    expect(stage).toContain('"status":"failed"');
    expect(stage).toContain('"committed":true');
    expect(stage).toContain('"saved":"local"');
    expect(stage).not.toContain("checkpoint committed");
    expect(stage).not.toContain('"pushed":true');

    const blocked = path.join(dir, "blocked");
    mkdirSync(blocked);
    const render = spawnSync(process.execPath, [SUMMARY, "render"], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        JOBRADAR_SUMMARY_DIR: stageDir,
        GITHUB_STEP_SUMMARY: blocked,
      },
    });
    expect(render.status).toBe(0);
    expect(render.stderr).toContain("The task result is unchanged");
    expect(readFileSync(official, "utf8")).toBe("OFFICIAL\n");
  });

  it("reports this run's outcome without turning historical failures or an earlier inflight count into a partial", () => {
    const markdown = renderMarkdown(successRun(), { jobStatus: "success" });
    const head = markdown.slice(0, markdown.indexOf("<details>"));

    expect(head).not.toContain("### ");
    expect(head).toContain("| Result | success |");
    expect(head).toContain("| Scan | 2256 companies, 5 candidates, 4 skipped, 1 queued for batch |");
    expect(head).toContain("| Opportunities added | 2 |");
    expect(head).toContain("| Notification jobs | 0 |");
    expect(head).toContain("1 collected");
    expect(head).toContain("no notification job; filter level 1");
    expect(head).toContain("| Opportunities updated | 1 |");
    expect(head).toContain("| Data and board | pushed |");
    expect(head).toContain("| Notifications | no new notification jobs |");
    expect(head).toContain("| Still waiting | none |");
    expect(head).toContain("| Existing stopped failures | 2 |");
    expect(head).toContain("| AI cost | 0.0005466 |");
    expect(head).toContain("No batches are waiting.");
    expect(head).not.toContain("| 3 |");
    expect(markdown).not.toContain("partial");
    expect(markdown).not.toContain("Part of this run failed");
    expect(markdown).not.toContain("can run again");
    expect(markdown).not.toContain("Not persisted");
    expect(markdown).toContain("<summary>執行細節</summary>");
    expect(markdown).toContain("### Jobs (scan)");
    expect(markdown).toContain("### Batch (submit)");
    expect(markdown).toContain("### Batch (collect)");
    expect(markdown).toContain("### Commit (job data)");
    expect(markdown).toContain("### Push (board)");
  });

  it("keeps identical counts for different events and counts one event once", () => {
    const pass = {
      stage: "batch",
      mode: "collect",
      status: "success",
      collected: 1,
      jobsSaved: 0,
      cost: 0.003,
      queued: 0,
      inflight: 0,
      retrying: 0,
      pendingResults: 0,
    };
    const separate = renderMarkdown([pass, { ...pass }], { jobStatus: "success" });
    const separateHead = separate.slice(0, separate.indexOf("<details>"));
    expect(separateHead).toContain("2 collected");
    expect(separateHead).toContain("| AI cost | 0.006 |");

    const repeated = renderMarkdown(
      [
        { ...pass, event: "batch-1" },
        { ...pass, event: "batch-1" },
      ],
      { jobStatus: "success" }
    );
    const repeatedHead = repeated.slice(0, repeated.indexOf("<details>"));
    expect(repeatedHead).toContain("1 collected");
    expect(repeatedHead).toContain("| AI cost | 0.003 |");
    expect(repeatedHead).not.toContain("0.006");
    expect(repeatedHead).not.toContain("2 collected");
  });

  it("shows a new stop, a rejected push, an interrupted collect, and an unknown cost without guessing zero", () => {
    const stopped = renderMarkdown(
      [
        {
          stage: "batch",
          mode: "collect",
          status: "partial",
          collected: 1,
          jobsSaved: 0,
          failed: 1,
          queued: 0,
          inflight: 0,
          retrying: 0,
          pendingResults: 0,
          stopped: 2,
          saved: "complete",
        },
      ],
      { jobStatus: "success" }
    );
    expect(stopped.slice(0, stopped.indexOf("<details>"))).toContain("| Result | success |");
    expect(stopped).toContain("1 newly stopped");
    expect(stopped).toContain("This run stopped 1 batch analysis.");
    expect(stopped).not.toContain("This run failed");
    expect(stopped).not.toContain("Not persisted");

    const interrupted = renderMarkdown(failedRun(), { jobStatus: "failure" });
    const failedHead = interrupted.slice(0, interrupted.indexOf("<details>"));
    expect(failedHead).toContain("| Result | failed |");
    expect(failedHead).toContain("last confirmed: inflight 1; final state unknown");
    expect(failedHead).toContain("| Recovery | committed locally, push rejected |");
    expect(failedHead).toContain("| AI cost | unknown |");
    expect(failedHead).not.toContain("| AI cost | 0 |");
    expect(failedHead).not.toContain("| Still waiting | none |");
    expect(interrupted).toContain("Collection did not finish");
    expect(interrupted).toContain("| Counts | unknown |");
    expect(interrupted).toContain("| Pushed | no |");
    expect(interrupted).not.toContain("| Pushed | yes |");

    const unknownCost = renderMarkdown([
      {
        stage: "batch",
        mode: "collect",
        status: "success",
        collected: 1,
        jobsSaved: 1,
        queued: 0,
        inflight: 0,
        retrying: 0,
        pendingResults: 0,
      },
    ]);
    expect(unknownCost).toContain("| AI cost | unknown |");
    expect(unknownCost.slice(0, unknownCost.indexOf("<details>"))).not.toContain("| AI cost | 0 |");
  });

  it("warns when the final snapshot still has batches to collect", () => {
    const markdown = renderMarkdown(waitingRun(), { jobStatus: "success" });
    const head = markdown.slice(0, markdown.indexOf("<details>"));

    expect(head).toContain("| Result | success |");
    expect(head).toContain("| Still waiting | queued 2, inflight 1, retrying 1 |");
    expect(head).toContain("can run again");
    expect(markdown).toContain("<summary>執行細節</summary>");
    expect(markdown).toContain("### Batch (submit)");
  });
});

function queue(overrides: Record<string, unknown> = {}) {
  return {
    queued: 0,
    inflight: 0,
    retrying: 0,
    pendingResults: 0,
    ...overrides,
  };
}

function successRun() {
  return [
    {
      stage: "jobs",
      mode: "scan",
      status: "success",
      companies: 2256,
      discovered: 5,
      received: 5,
      jobsAdded: 0,
      opportunitiesAdded: 2,
      skipped: 4,
      failed: 0,
      batched: 1,
      listingFailed: 0,
      notStarted: 0,
      saved: "complete",
    },
    {
      stage: "batch",
      mode: "submit",
      status: "success",
      submitted: 1,
      collected: 0,
      jobsSaved: 0,
      failed: 0,
      stopped: 2,
      cost: 0,
      saved: "complete",
      ...queue({ inflight: 1 }),
    },
    { stage: "commit", label: "job data", status: "success", committed: true },
    { stage: "push", label: "job data", status: "success", pushed: true },
    { stage: "commit", label: "board", status: "success", committed: true },
    { stage: "push", label: "board", status: "success", pushed: true },
    {
      stage: "notify",
      status: "success",
      reason: "no new jobs",
      notifiedJobs: 0,
      candidates: 0,
      saved: "unchanged",
    },
    {
      stage: "batch",
      mode: "collect",
      status: "success",
      submitted: 0,
      collected: 1,
      jobsSaved: 0,
      notificationSkipped: 1,
      filterReasons: { level: 1 },
      reused: 0,
      opportunitiesAdded: 0,
      opportunitiesUpdated: 1,
      failed: 0,
      stopped: 2,
      cost: 0.0005466,
      saved: "complete",
      ...queue(),
    },
  ];
}

function failedRun() {
  return [
    {
      stage: "batch",
      mode: "submit",
      status: "success",
      submitted: 1,
      collected: 0,
      jobsSaved: 0,
      failed: 0,
      cost: 0,
      saved: "complete",
      ...queue({ inflight: 1 }),
    },
    { stage: "batch", mode: "collect", status: "failed", reason: "batch failed", saved: "unknown" },
    { stage: "recover", status: "success", committed: true, saved: "local" },
    { stage: "push", label: "batch recovery", status: "failed", pushed: false, reason: "push did not succeed" },
  ];
}

function waitingRun() {
  return [
    {
      stage: "batch",
      mode: "submit",
      status: "success",
      submitted: 1,
      collected: 0,
      jobsSaved: 0,
      failed: 0,
      cost: 0,
      saved: "complete",
      ...queue({ queued: 2, inflight: 1, retrying: 1 }),
    },
  ];
}
