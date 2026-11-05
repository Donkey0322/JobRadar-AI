import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  batchDue,
  batchShouldStart,
  classifyFiles,
  collectShouldContinue,
  jobsGate,
  MAINTENANCE,
  maintenancePlan,
  notifyEnabled,
  PIPELINE_PREFIXES,
  resolvePushBounds,
  routePush,
  SCAN_CRONS,
  shouldNotify,
  SYNC_CRONS,
  WEBHOOK_PUSH_COMMIT_CAP,
} from "../../../.github/scripts/workflow-route.mjs";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const ROUTE = path.join(ROOT, ".github/scripts/workflow-route.mjs");

function workflow(name: string) {
  return readFileSync(path.join(ROOT, ".github/workflows", name), "utf8");
}

function crons(source: string) {
  return [...source.matchAll(/- cron: "([^"]+)"/g)].map((match) => match[1]);
}

describe("jobs gate", () => {
  it("scans on a California weekday and uses a 3-day Monday catch-up", () => {
    expect(jobsGate("schedule", "", "10 8-23 * * 2-5", "2026-01-06T18:00:00+00:00")).toMatchObject({
      should_run: "true",
      task: "scan",
      lookback_days: "2",
    });
    expect(jobsGate("schedule", "", "10 7-23 * * 1", "2026-01-05T08:30:00+00:00")).toMatchObject({
      should_run: "true",
      task: "scan",
      lookback_days: "3",
      message: "Using a 3-day lookback for the Monday weekend catch-up.",
    });
    expect(
      jobsGate("schedule", "", "10 0-7 * * 2-6", "2026-07-06T07:30:00+00:00").lookback_days
    ).toBe("3");
  });

  it("skips scan on the California weekend and sync outside 07:00-23:40", () => {
    expect(jobsGate("schedule", "", "10 0-7 * * 2-6", "2026-01-04T20:00:00+00:00")).toMatchObject({
      should_run: "false",
      task: "scan",
    });
    expect(jobsGate("schedule", "", "*/20 0-7 * * *", "2026-01-06T14:30:00+00:00").should_run).toBe(
      "false"
    );
    expect(jobsGate("schedule", "", "*/20 0-7 * * *", "2026-01-06T08:10:00+00:00").should_run).toBe(
      "false"
    );
    expect(jobsGate("schedule", "", "*/20 14-23 * * *", "2026-01-06T15:00:00+00:00")).toMatchObject(
      {
        should_run: "true",
        task: "sync",
      }
    );
    expect(
      jobsGate("schedule", "", "*/20 14-23 * * *", "2026-01-07T07:40:00+00:00").should_run
    ).toBe("true");
  });

  it("runs the selected pipeline immediately when dispatched", () => {
    expect(jobsGate("workflow_dispatch", "scan", "", "2026-01-04T20:00:00+00:00")).toEqual({
      should_run: "true",
      task: "scan",
      lookback_days: "2",
      message: "",
    });
    expect(jobsGate("workflow_dispatch", "sync", "", "2026-01-04T20:00:00+00:00").task).toBe(
      "sync"
    );
  });
});

describe("publish routing", () => {
  it("publishes scan, sync, batch, and issue commits once", () => {
    const jobs = workflow("jobs.yml");
    const batch = workflow("batch.yml");
    const issue = workflow("add-job-from-issue.yml");
    const publishData = workflow("publish-data.yml");
    const prefixes = PIPELINE_PREFIXES;

    for (const prefix of prefixes) {
      expect(publishData).toContain(`startsWith(github.event.head_commit.message, '${prefix}')`);
    }
    expect(jobs).toContain('git commit -m "chore(discovery): update new jobs"');
    expect(jobs).toContain('git commit -m "chore(community): update new jobs"');
    expect(batch).toContain('git commit -m "chore(batch): collect batch analysis"');
    expect(issue).toContain("data: add job from issue #");

    const files = ["data/jobs.ndjson", "data/opportunities.ndjson"];
    expect(routePush("chore(discovery): update new jobs", files).run).toBe(false);
    expect(routePush("chore(community): update new jobs", files).run).toBe(false);
    expect(routePush("chore(batch): collect batch analysis", files).run).toBe(false);
    expect(routePush("data: add job from issue #12", files).run).toBe(false);
    expect(routePush("chore(batch): checkpoint inflight submissions [skip ci]", files)).toEqual({
      run: false,
      board: false,
      notify: false,
    });
    expect(
      routePush("edit config", ["config.json", "data/jobs.ndjson"], ["edit config", "add a job"])
    ).toEqual({ run: true, board: true, notify: true });
  });

  it("refreshes the board for config, opportunities, archive, and the render script", () => {
    expect(routePush("chore: update config from setup issue #4", ["config.json"])).toEqual({
      run: true,
      board: true,
      notify: false,
    });
    expect(routePush("edit opportunities", ["data/opportunities.ndjson"]).notify).toBe(false);
    expect(routePush("edit archive", ["data/archive/opportunities-2026.ndjson"]).board).toBe(true);
    expect(routePush("edit renderer", ["src/modules/board/render.ts"])).toEqual({
      run: true,
      board: true,
      notify: false,
    });
    expect(workflow("publish-data.yml")).toContain("config.json");
    expect(workflow("publish-data.yml")).toContain("data/opportunities.ndjson");
    expect(workflow("publish-data.yml")).toContain("data/archive/opportunities-*.ndjson");
    expect(workflow("publish-data.yml")).toContain("src/modules/board/**");
    expect(workflow("publish-data.yml")).toContain("data/jobs.ndjson");
  });

  it("skips notify when a run saved no jobs or notifications are disabled", () => {
    const jobs = workflow("jobs.yml");
    const publish = workflow("publish-jobs.yml");

    expect(jobs).toContain("needs.fetch.outputs.has_changes == 'true'");
    expect(jobs).not.toContain("gh run cancel");
    expect(notifyEnabled({ dashboard: {} })).toBe(true);
    expect(notifyEnabled({})).toBe(true);
    expect(notifyEnabled({ dashboard: { notify: false } })).toBe(false);
    expect(publish).toContain("needs.prepare.outputs.send == 'true'");
    expect(classifyFiles(["data/batch/queue.ndjson"])).toEqual({
      run: false,
      board: false,
      notify: false,
    });
  });

  it("notifies the saved data commit when board refresh fails", () => {
    const publish = workflow("publish-jobs.yml");

    expect(publish).toContain('pnpm jobctl notify commit "$DATA_SHA"');
    expect(publish).toContain('pnpm jobctl notify range "$FROM_SHA" "$DATA_SHA"');
    expect(publish).toContain("ref: ${{ github.ref_name }}");
    expect(publish).not.toContain("github.sha");
    expect(publish).not.toContain("concurrency:");
    expect(publish).toContain("needs.board.result == 'failure'");
    expect(publish).toContain("always()");
    expect(shouldNotify("failure", true, true, "success")).toBe(true);
    expect(shouldNotify("failure", true, false, "success")).toBe(false);
    expect(shouldNotify("failure", false, true, "success")).toBe(false);
    expect(shouldNotify("success", true, true, "success")).toBe(true);
    expect(shouldNotify("cancelled", true, true, "success")).toBe(false);
  });
});

describe("batch gate", () => {
  it("collects pending work and does not restart from its own collect commit", () => {
    const batch = workflow("batch.yml");

    expect(batchShouldStart("push", "chore(batch): collect batch analysis")).toBe(false);
    expect(
      batchShouldStart("push", "chore(batch): checkpoint inflight submissions [skip ci]")
    ).toBe(false);
    expect(batchShouldStart("schedule", "")).toBe(true);
    expect(batchDue("workflow_dispatch", null, null)).toBe(true);
    expect(batchDue("push", "", "[]")).toBe(false);
    expect(batchDue("schedule", "job\n", "[]")).toBe(true);
    expect(batchDue("schedule", "", '[{"id":"batch"}]')).toBe(true);
    expect(batch).toContain(
      "startsWith(github.event.head_commit.message, 'chore(batch): collect')"
    );
    expect(batch).toContain("contains(github.event.head_commit.message, '[skip ci]')");
    expect(batch).toContain("classify-head");
    expect(batch).toContain("needs.submit.outputs.checkpoint_sha");
    expect(batch).toContain("needs.collect.outputs.collect_sha");
    const checkpointJob = batch.slice(
      batch.indexOf("\n  publish-checkpoint:"),
      batch.indexOf("\n  collect:")
    );
    expect(checkpointJob).toContain("needs: submit");
    expect(checkpointJob).not.toContain("needs.collect");
    expect(checkpointJob).not.toContain("publish-checkpoint.result");
    const collectJob = batch.slice(
      batch.indexOf("\n  collect:"),
      batch.indexOf("\n  publish-collect:")
    );
    expect(collectJob).toContain("needs: [submit, publish-checkpoint]");
    expect(collectJob).toContain("always()");
    expect(collectJob).toContain("needs.publish-checkpoint.result == 'success'");
    expect(collectJob).toContain("needs.publish-checkpoint.result == 'failure'");
    expect(collectJob).toContain("needs.publish-checkpoint.result == 'skipped'");
    expect(batch.match(/concurrency:/g)).toHaveLength(1);
    expect(batch).toContain(
      "needs.collect.result == 'success' && needs.collect.outputs.collect_publish == 'true'"
    );
    expect(batch).toContain('cron: "47 * * * *"');
    expect(collectShouldContinue("success", "success")).toBe(true);
    expect(collectShouldContinue("success", "failure")).toBe(true);
    expect(collectShouldContinue("success", "skipped")).toBe(true);
    expect(collectShouldContinue("success", "cancelled")).toBe(false);
    expect(collectShouldContinue("failure", "skipped")).toBe(false);
  });
});

describe("maintenance routing", () => {
  it("keeps the clean schedule and maps each manual task", () => {
    const maintenance = workflow("maintenance.yml");
    const plans: Record<string, ReturnType<typeof maintenancePlan>> = {
      schedule: maintenancePlan("schedule", "dedup"),
    };
    for (const task of Object.keys(MAINTENANCE)) {
      plans[task] = maintenancePlan("workflow_dispatch", task);
    }

    expect(maintenance).toContain('cron: "0 0 */14 * *"');
    expect(plans.schedule.task).toBe("clean");
    expect(plans.schedule.message).toBe("chore(clean-outdated-url): clean outdated url");
    for (const task of ["clean", "dedup", "company refresh", "board refresh"]) {
      const files =
        task === "board refresh"
          ? ["README.md"]
          : ["data/jobs.ndjson", "data/opportunities.ndjson"];
      expect(maintenance).toContain(`- ${task}`);
      expect(maintenance).toContain(plans[task].argv.join(" "));
      expect(routePush(plans[task].message, files).run).toBe(task !== "board refresh");
    }
    expect(plans["board refresh"].message).toBe("docs: update generated job boards");
  });

  it("commits only the files the selected task owns", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "jobradar-maintenance-"));
    const git = (...args: string[]) => {
      const result = spawnSync("git", args, {
        cwd: directory,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "test",
          GIT_AUTHOR_EMAIL: "test@example.com",
          GIT_COMMITTER_NAME: "test",
          GIT_COMMITTER_EMAIL: "test@example.com",
        },
      });
      expect(result.status, result.stderr).toBe(0);
    };
    git("init", "-b", "main");
    git("-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "init");
    writeFileSync(path.join(directory, "README.md"), "board\n");
    writeFileSync(path.join(directory, "data-note.txt"), "leave me\n");

    const inherited = { ...process.env };
    delete inherited.GITHUB_OUTPUT;
    const committed = spawnSync(process.execPath, [ROUTE, "maintenance-commit"], {
      cwd: directory,
      encoding: "utf8",
      env: { ...inherited, EVENT_NAME: "workflow_dispatch", TASK: "board refresh" },
    });

    expect(committed.status, committed.stderr).toBe(0);
    expect(committed.stdout).toContain("has_commit=true");
    const names = spawnSync("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], {
      cwd: directory,
      encoding: "utf8",
    });
    expect(names.stdout.trim()).toBe("README.md");
    expect(readFileSync(path.join(directory, "data-note.txt"), "utf8")).toBe("leave me\n");
  });
});

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const ZERO_SHA = "0".repeat(40);

function runGit(directory: string, args: string[]) {
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd: directory,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  expect(result.status, `${args.join(" ")}\n${result.stderr}`).toBe(0);
  return result.stdout.trim();
}

function publishRoute(directory: string, env: Record<string, string>) {
  const inherited = { ...process.env };
  delete inherited.GITHUB_OUTPUT;
  const result = spawnSync(process.execPath, [ROUTE, "publish-route"], {
    cwd: directory,
    encoding: "utf8",
    env: { ...inherited, ...env },
  });
  expect(result.status, result.stderr).toBe(0);
  return Object.fromEntries(
    result.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      })
  ) as Record<string, string>;
}

describe("saved ranges", () => {
  it("keeps a checkpoint job when the collect commit adds no jobs", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "jobradar-checkpoint-"));
    const jobs = path.join(directory, "data/jobs.ndjson");
    mkdirSync(path.dirname(jobs), { recursive: true });
    runGit(directory, ["init", "-b", "main"]);
    writeFileSync(jobs, '{"link":"https://example.com/old"}\n');
    runGit(directory, ["add", "data/jobs.ndjson"]);
    runGit(directory, ["commit", "-m", "base"]);
    const base = runGit(directory, ["rev-parse", "HEAD"]);

    writeFileSync(jobs, '{"link":"https://example.com/old"}\n{"link":"https://example.com/new"}\n');
    runGit(directory, ["add", "data/jobs.ndjson"]);
    runGit(directory, ["commit", "-m", "chore(batch): checkpoint inflight submissions [skip ci]"]);
    const checkpoint = runGit(directory, ["rev-parse", "HEAD"]);
    expect(runGit(directory, ["status", "--porcelain"])).toBe("");
    expect(
      runGit(directory, ["diff", "-U0", base, checkpoint, "--", "data/jobs.ndjson"])
    ).toContain("https://example.com/new");

    const inherited = { ...process.env };
    delete inherited.GITHUB_OUTPUT;
    const classified = spawnSync(process.execPath, [ROUTE, "classify-head"], {
      cwd: directory,
      encoding: "utf8",
      env: inherited,
    });
    expect(classified.status, classified.stderr).toBe(0);
    expect(classified.stdout).toContain("notify=true");
    expect(classified.stdout).toContain(`data_sha=${checkpoint}`);

    mkdirSync(path.join(directory, "data/batch"), { recursive: true });
    writeFileSync(path.join(directory, "data/batch/inflight.json"), "[]\n");
    runGit(directory, ["add", "data/batch/inflight.json"]);
    runGit(directory, ["commit", "-m", "chore(batch): collect batch analysis"]);
    expect(
      runGit(directory, ["diff", "--name-only", checkpoint, "HEAD", "--", "data/jobs.ndjson"])
    ).toBe("");
    const collected = spawnSync(process.execPath, [ROUTE, "classify-head"], {
      cwd: directory,
      encoding: "utf8",
      env: inherited,
    });
    expect(collected.status, collected.stderr).toBe(0);
    expect(collected.stdout).toContain("notify=false");
    expect(
      batchShouldStart("push", "chore(batch): checkpoint inflight submissions [skip ci]")
    ).toBe(false);
  });

  it("uses one before and after range when a later commit only changes config", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "jobradar-range-"));
    mkdirSync(path.join(directory, "data"), { recursive: true });
    runGit(directory, ["init", "-b", "main"]);
    writeFileSync(path.join(directory, "config.json"), '{"dashboard":{"notify":true}}\n');
    writeFileSync(path.join(directory, "data/jobs.ndjson"), '{"link":"https://example.com/old"}\n');
    runGit(directory, ["add", "config.json", "data/jobs.ndjson"]);
    runGit(directory, ["commit", "-m", "base"]);
    const before = runGit(directory, ["rev-parse", "HEAD"]);

    writeFileSync(
      path.join(directory, "data/jobs.ndjson"),
      '{"link":"https://example.com/old"}\n{"link":"https://example.com/new"}\n'
    );
    runGit(directory, ["add", "data/jobs.ndjson"]);
    runGit(directory, ["commit", "-m", "add a job"]);
    const jobCommit = runGit(directory, ["rev-parse", "HEAD"]);

    writeFileSync(path.join(directory, "config.json"), '{"dashboard":{"notify":true},"note":1}\n');
    runGit(directory, ["add", "config.json"]);
    runGit(directory, ["commit", "-m", "edit config"]);
    const after = runGit(directory, ["rev-parse", "HEAD"]);

    expect(runGit(directory, ["diff", "--name-only", "HEAD~1", "HEAD"])).not.toContain(
      "data/jobs.ndjson"
    );
    expect(runGit(directory, ["diff", "-U0", before, after, "--", "data/jobs.ndjson"])).toContain(
      "https://example.com/new"
    );
    expect(runGit(directory, ["diff", "-U0", "HEAD~1", "HEAD", "--", "data/jobs.ndjson"])).toBe("");

    const routed = publishRoute(directory, {
      BEFORE: before,
      SHA: after,
      COMMIT_MESSAGE: "edit config",
      PUSH_COMMITS: JSON.stringify([jobCommit, after]),
    });
    expect(routed.from_sha).toBe(before);
    expect(routed.data_sha).toBe(after);
    expect(routed.notify).toBe("true");

    const zeroBefore = publishRoute(directory, {
      BEFORE: ZERO_SHA,
      SHA: after,
      COMMIT_MESSAGE: "edit config",
      PUSH_COMMITS: JSON.stringify([jobCommit, after]),
    });
    expect(zeroBefore.from_sha).toBe(before);
    expect(zeroBefore.data_sha).toBe(after);
    expect(zeroBefore.notify).toBe("true");

    const emptyPush = publishRoute(directory, {
      BEFORE: ZERO_SHA,
      SHA: after,
      COMMIT_MESSAGE: "edit config",
      PUSH_COMMITS: "[]",
    });
    expect(emptyPush.from_sha).toBe(after);
    expect(emptyPush.data_sha).toBe(after);
    expect(emptyPush.notify).toBe("false");

    expect(resolvePushBounds(before, after, [before], [jobCommit, after])).toEqual({
      status: "range",
      from: before,
      to: after,
      reason: "",
    });
    expect(resolvePushBounds(ZERO_SHA, after, [before], [jobCommit, after])).toEqual({
      status: "range",
      from: before,
      to: after,
      reason: "",
    });
    expect(resolvePushBounds(ZERO_SHA, after, [], [])).toEqual({
      status: "empty",
      from: after,
      to: after,
      reason: "",
    });
    expect(resolvePushBounds(ZERO_SHA, after, [], ["root"])).toEqual({
      status: "range",
      from: EMPTY_TREE,
      to: after,
      reason: "",
    });
  });

  it("uses the empty tree when the pushed commit has no parent", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "jobradar-root-"));
    mkdirSync(path.join(directory, "data"), { recursive: true });
    runGit(directory, ["init", "-b", "main"]);
    writeFileSync(
      path.join(directory, "data/jobs.ndjson"),
      '{"link":"https://example.com/root"}\n'
    );
    runGit(directory, ["add", "data/jobs.ndjson"]);
    runGit(directory, ["commit", "-m", "add a job"]);
    const root = runGit(directory, ["rev-parse", "HEAD"]);

    const routed = publishRoute(directory, {
      BEFORE: ZERO_SHA,
      SHA: root,
      COMMIT_MESSAGE: "add a job",
      PUSH_COMMITS: JSON.stringify([root]),
    });
    expect(routed.from_sha).toBe(EMPTY_TREE);
    expect(routed.data_sha).toBe(root);
    expect(routed.notify).toBe("true");
    expect(runGit(directory, ["diff", "--name-only", EMPTY_TREE, root])).toContain(
      "data/jobs.ndjson"
    );
  });

  it("rejects a new-branch commit list that may be truncated", () => {
    const cap = WEBHOOK_PUSH_COMMIT_CAP;
    expect(cap).toBe(2048);
    const after = "b".repeat(40);
    const parent = "c".repeat(40);
    const capped = Array.from({ length: cap }, (_, index) => index.toString(16).padStart(40, "a"));
    const incomplete = resolvePushBounds(ZERO_SHA, after, [parent], capped);
    expect(incomplete.status).toBe("incomplete");
    expect(incomplete.from).toBe("");
    expect(incomplete.reason).toContain("2048");
    expect(incomplete.reason).toContain("Notification was not sent.");

    const below = capped.slice(0, cap - 1);
    expect(resolvePushBounds(ZERO_SHA, after, [parent], below)).toEqual({
      status: "range",
      from: parent,
      to: after,
      reason: "",
    });
    expect(resolvePushBounds("d".repeat(40), after, [parent], capped)).toEqual({
      status: "range",
      from: "d".repeat(40),
      to: after,
      reason: "",
    });

    const directory = mkdtempSync(path.join(tmpdir(), "jobradar-truncated-"));
    const inherited = { ...process.env };
    delete inherited.GITHUB_OUTPUT;
    const failed = spawnSync(process.execPath, [ROUTE, "publish-route"], {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...inherited,
        BEFORE: ZERO_SHA,
        SHA: after,
        COMMIT_MESSAGE: "add a job",
        PUSH_COMMITS: JSON.stringify(capped),
      },
    });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("Notification was not sent.");
    expect(failed.stdout).not.toContain("notify=");
    expect(failed.stdout).not.toContain(capped[0]);

    const missing = spawnSync(process.execPath, [ROUTE, "publish-route"], {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...inherited,
        BEFORE: ZERO_SHA,
        SHA: after,
        COMMIT_MESSAGE: "add a job",
        PUSH_COMMITS: JSON.stringify(["e".repeat(40)]),
      },
    });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("could not be resolved");
    expect(missing.stdout).not.toContain("notify=");
  });
});

describe("workflow inventory", () => {
  it("keeps CI, the event entry points, and the shared publish path", () => {
    expect(readdirSync(path.join(ROOT, ".github/workflows")).sort()).toEqual([
      "add-job-from-issue.yml",
      "batch.yml",
      "check-setup.yml",
      "ci.yml",
      "jobs.yml",
      "maintenance.yml",
      "publish-data.yml",
      "publish-jobs.yml",
      "setup-from-issue.yml",
    ]);

    const ci = workflow("ci.yml");
    expect(ci).toContain("pnpm typecheck");
    expect(ci).toContain("pnpm test");
    expect(ci).toContain("pnpm lint");
    expect(ci).toContain('"data/**"');
    expect(ci).toContain('"README.md"');

    expect(crons(workflow("jobs.yml"))).toEqual([...SCAN_CRONS, ...SYNC_CRONS]);

    expect(workflow("setup-from-issue.yml")).toContain("types: [opened, edited]");
    expect(workflow("check-setup.yml")).toContain("/check-setup");
    expect(workflow("add-job-from-issue.yml")).toContain(
      "pnpm tsx scripts/github/add-job-from-issue.ts"
    );
    expect(workflow("jobs.yml")).toContain("DISCOVERY_LOOKBACK_DAYS");
    expect(workflow("jobs.yml")).toContain("pnpm jobctl scan");
    expect(workflow("jobs.yml")).toContain("pnpm jobctl sync");
    for (const name of [
      "jobs.yml",
      "batch.yml",
      "maintenance.yml",
      "publish-data.yml",
      "add-job-from-issue.yml",
      "setup-from-issue.yml",
    ]) {
      expect(workflow(name)).toContain("group: job-data-sync");
      expect(workflow(name)).toContain("cancel-in-progress: false");
      expect(workflow(name)).toContain("queue: max");
    }
    expect(workflow("publish-jobs.yml")).not.toContain("concurrency:");
    expect(workflow("check-setup.yml")).not.toContain("job-data-sync");
    expect(workflow("ci.yml")).not.toContain("job-data-sync");
    expect(workflow("publish-data.yml")).toContain("from_sha: ${{ needs.route.outputs.from_sha }}");
  });
});
