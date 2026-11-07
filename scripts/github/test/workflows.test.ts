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
  commitHistoryPlan,
  jobsGate,
  jobsResultAfterBatch,
  MAINTENANCE,
  maintenancePlan,
  notifyEnabled,
  PIPELINE_PREFIXES,
  rebaseHistoryPlan,
  resolvePushBounds,
  routePush,
  SCAN_CRONS,
  shouldNotify,
  SYNC_CRONS,
  WEBHOOK_PUSH_COMMIT_CAP,
} from "@github/scripts/workflow-route.mjs";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const ROUTE = path.join(ROOT, ".github/scripts/workflow-route.mjs");

function workflow(name: string) {
  return readFileSync(path.join(ROOT, ".github/workflows", name), "utf8");
}

function action(name: string) {
  return readFileSync(path.join(ROOT, ".github/actions", name, "action.yml"), "utf8");
}

function stepBlocks(source: string) {
  const blocks: string[] = [];
  let current: string[] | null = null;
  for (const line of source.split("\n")) {
    if (/^ {6}- /.test(line)) {
      if (current) blocks.push(current.join("\n"));
      current = [line];
      continue;
    }
    if (current) current.push(line);
  }
  if (current) blocks.push(current.join("\n"));
  return blocks;
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
    const batch = action("batch-work");
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

  it("uses the built-in token for pipeline data pushes and PAT for the publish entry", () => {
    const jobs = workflow("jobs.yml");
    const batchWorkflow = workflow("batch.yml");
    const batch = action("batch-work");
    const maintenance = workflow("maintenance.yml");
    const issue = workflow("add-job-from-issue.yml");
    const setup = workflow("setup-from-issue.yml");
    const publishData = workflow("publish-data.yml");

    const dataPush = stepBlocks(jobs).find((block) => block.includes("Rebase and push data"));
    expect(dataPush).toContain("token: ${{ github.token }}");
    expect(dataPush).not.toContain("secrets.PAT");
    expect(jobs).toContain("contents: write");
    expect(stepBlocks(jobs).some((block) => block.includes("token: ${{ secrets.PAT }}"))).toBe(
      true
    );

    const checkout = (source: string) =>
      stepBlocks(source).find((block) => block.includes("actions/checkout@v6"));
    expect(checkout(jobs)).toContain("persist-credentials: false");
    expect(checkout(batchWorkflow)).toContain("persist-credentials: false");
    for (const name of [
      "maintenance.yml",
      "add-job-from-issue.yml",
      "setup-from-issue.yml",
      "publish-data.yml",
      "publish-jobs.yml",
    ]) {
      expect(checkout(workflow(name))).not.toContain("persist-credentials");
    }

    const saved = stepBlocks(jobs).find((block) => block.includes("Publish saved data"));
    expect(saved).toContain("data_sha: ${{ steps.saved.outputs.data_sha }}");
    expect(saved).toContain("token: ${{ secrets.PAT }}");
    expect(jobs).toContain('echo "data_sha=$(git rev-parse HEAD)"');

    for (const source of [jobs, batchWorkflow]) {
      const work = stepBlocks(source).find((block) =>
        block.includes("uses: ./.github/actions/batch-work")
      );
      expect(work).toContain("token: ${{ github.token }}");
      expect(work).toContain("publish_token: ${{ secrets.PAT }}");
      expect(work).toContain("PAT: ${{ secrets.PAT }}");
    }
    expect(batchWorkflow).toContain("contents: write");

    const checkpoint = batch.slice(
      batch.indexOf("Push inflight checkpoint"),
      batch.indexOf("Classify checkpoint commit")
    );
    const collected = batch.slice(
      batch.indexOf("Push collected results"),
      batch.indexOf("Classify collected data commit")
    );
    expect(checkpoint).toContain("token: ${{ inputs.token }}");
    expect(checkpoint).not.toContain("publish_token");
    expect(collected).toContain("token: ${{ inputs.token }}");
    expect(collected).not.toContain("publish_token");
    expect(batch).toContain("token: ${{ inputs.publish_token || inputs.token }}");

    const maintenancePush = stepBlocks(maintenance).find((block) =>
      block.includes("uses: ./.github/actions/rebase-push")
    );
    expect(maintenancePush).toContain("token: ${{ secrets.PAT }}");
    expect(maintenancePush).not.toContain("github.token");
    expect(
      routePush("chore(clean-outdated-url): clean outdated url", ["data/jobs.ndjson"]).run
    ).toBe(true);

    for (const block of stepBlocks(issue).filter(
      (block) =>
        block.includes("uses: ./.github/actions/rebase-push") ||
        block.includes("uses: ./.github/actions/batch-work")
    )) {
      expect(block).toContain("token: ${{ secrets.PAT }}");
      expect(block).not.toContain("github.token");
      expect(block).not.toContain("publish_token");
    }
    expect(stepBlocks(setup).find((block) => block.includes("rebase-push"))).toContain(
      "token: ${{ secrets.PAT }}"
    );

    expect(publishData).toContain("push:");
    expect(publishData).toContain("group: job-data-sync");
    expect(publishData).toContain("queue: max");
    expect(publishData).toContain(
      "!startsWith(github.event.head_commit.message, 'chore(discovery):')"
    );
    expect(action("rebase-push")).toContain("bash .github/scripts/use-push-token.sh");
    const publishSaved = action("publish-saved");
    expect(publishSaved).toContain("bash .github/scripts/use-push-token.sh");
    const ensure = publishSaved.slice(
      publishSaved.indexOf("Ensure the notification commits are present"),
      publishSaved.indexOf("Check whether this repo sends notifications")
    );
    expect(ensure.indexOf("bash .github/scripts/use-push-token.sh")).toBeGreaterThan(-1);
    expect(ensure.indexOf("bash .github/scripts/use-push-token.sh")).toBeLessThan(
      ensure.indexOf("git fetch")
    );
    const fastForward = publishSaved.slice(publishSaved.indexOf("Fast-forward to the branch tip"));
    expect(fastForward.indexOf("bash .github/scripts/use-push-token.sh")).toBeLessThan(
      fastForward.indexOf("git fetch")
    );
    const rebase = action("rebase-push");
    expect(rebase.indexOf("bash .github/scripts/use-push-token.sh")).toBeLessThan(
      rebase.indexOf("git fetch")
    );
    expect(rebase.indexOf("bash .github/scripts/use-push-token.sh")).toBeLessThan(
      rebase.indexOf("git push")
    );
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
    const publish = action("publish-saved");

    expect(jobs).toContain("steps.fetch.outputs.has_changes == 'true'");
    expect(jobs).not.toContain("gh run cancel");
    expect(notifyEnabled({ dashboard: {} })).toBe(true);
    expect(notifyEnabled({})).toBe(true);
    expect(notifyEnabled({ dashboard: { notify: false } })).toBe(false);
    expect(publish).toContain("steps.notify.outputs.send == 'true'");
    expect(classifyFiles(["data/batch/queue.ndjson"])).toEqual({
      run: false,
      board: false,
      notify: false,
    });
  });

  it("notifies the saved data commit when board refresh fails", () => {
    const publish = action("publish-saved");

    expect(publish).toContain('pnpm jobctl notify commit "$DATA_SHA"');
    expect(publish).toContain('pnpm jobctl notify range "$FROM_SHA" "$DATA_SHA"');
    expect(publish).toContain("git merge --ff-only");
    expect(publish).not.toContain("github.sha");
    expect(publish).not.toContain("actions/checkout");
    expect(publish).not.toContain("concurrency:");
    expect(publish).toContain("steps.board.outcome == 'failure'");
    expect(publish).not.toContain("always()");
    expect(shouldNotify("failure", true, true, "success")).toBe(true);
    expect(shouldNotify("failure", true, false, "success")).toBe(false);
    expect(shouldNotify("failure", false, true, "success")).toBe(false);
    expect(shouldNotify("success", true, true, "success")).toBe(true);
    expect(shouldNotify("cancelled", true, true, "success")).toBe(false);
  });
});

describe("batch recovery state", () => {
  it("starts a batch run for saved real-time results", () => {
    expect(batchDue("schedule", "", "[]", "")).toBe(false);
    expect(batchDue("schedule", "", "[]", "\n \n")).toBe(false);
    expect(batchDue("schedule", "", "[]", '{"key":"greenhouse:1"}\n')).toBe(true);
    expect(batchDue("workflow_call", null, null, '{"key":"greenhouse:1"}\n')).toBe(true);
    expect(batchDue("workflow_call", "", "[]")).toBe(false);
  });

  it("recovers batch state with the shared push and does not publish that commit", () => {
    const blocks = action("batch-work").split(/\n(?= {4}- )/);
    const save = blocks.find((block) => block.includes("Save recoverable batch state"));
    const push = blocks.find((block) => block.includes("Push recoverable batch state"));
    const program = readFileSync(path.join(ROOT, "scripts/github/recover-batch.ts"), "utf8");

    expect(save).toContain(
      "failure() && !cancelled() && (steps.submit.outcome == 'failure' || steps.collect.outcome == 'failure')"
    );
    expect(save).toContain("pnpm exec tsx scripts/github/recover-batch.ts");
    expect(save).not.toContain("git add data/");
    expect(save).not.toContain("publish-saved");
    expect(push).toContain("steps.recover_save.outputs.committed == 'true'");
    expect(push).toContain("uses: ./.github/actions/rebase-push");
    expect(push).toContain("token: ${{ inputs.token }}");
    expect(push).not.toContain("publish_token");
    expect(program).toContain('gitText(root, ["reset", "--hard", "HEAD"])');
    expect(program).toContain("Recovery commit failed; working tree was left in place");

    const message = "chore(batch): checkpoint recoverable batch state [skip ci]";
    expect(program).toContain(message);
    expect(batchShouldStart("push", message)).toBe(false);
    expect(
      routePush(message, [
        "data/batch/queue.ndjson",
        "data/batch/inflight.json",
        "data/batch/results.ndjson",
        "data/batch/failures.ndjson",
      ])
    ).toEqual({
      run: false,
      board: false,
      notify: false,
    });
  });
});

describe("batch gate", () => {
  it("collects pending work and does not restart from its own collect commit", () => {
    const batch = action("batch-work");
    const entry = workflow("batch.yml");
    const jobs = workflow("jobs.yml");
    const issue = workflow("add-job-from-issue.yml");

    expect(batchShouldStart("push", "chore(batch): collect batch analysis")).toBe(false);
    expect(
      batchShouldStart("push", "chore(batch): checkpoint inflight submissions [skip ci]")
    ).toBe(false);
    expect(batchShouldStart("schedule", "")).toBe(true);
    expect(batchDue("workflow_dispatch", null, null)).toBe(false);
    expect(batchDue("workflow_call", null, null)).toBe(false);
    expect(batchDue("workflow_call", "", "[]")).toBe(false);
    expect(batchDue("workflow_call", "job\n", "[]")).toBe(true);
    expect(batchDue("workflow_call", "", '[{"id":"batch"}]')).toBe(true);
    expect(batchDue("push", "", "[]")).toBe(false);
    expect(batchDue("schedule", "job\n", "[]")).toBe(true);
    expect(batchDue("schedule", "", '[{"id":"batch"}]')).toBe(true);
    expect(entry).toContain(
      "startsWith(github.event.head_commit.message, 'chore(batch): collect')"
    );
    expect(entry).toContain("contains(github.event.head_commit.message, '[skip ci]')");
    expect(batch).toContain("classify-head");
    expect(batch).toContain("steps.checkpoint_route.outputs.data_sha");
    expect(batch).toContain("steps.collect_route.outputs.data_sha");
    expect(batch).not.toContain("concurrency:");
    expect(batch).not.toContain("workflow_call:");
    expect(batch).not.toContain("always()");
    const checkpoint = batch.slice(
      batch.indexOf("Checkpoint inflight submissions"),
      batch.indexOf("Wait and collect batch results")
    );
    expect(checkpoint).toContain("Publish checkpoint");
    expect(checkpoint).toContain("continue-on-error: true");
    expect(checkpoint).not.toContain("Wait and collect");
    const collect = batch.slice(
      batch.indexOf("Wait and collect batch results"),
      batch.indexOf("Fail when checkpoint publish failed")
    );
    expect(collect).toContain("steps.publish_checkpoint.outcome == 'success'");
    expect(collect).toContain("steps.publish_checkpoint.outcome == 'failure'");
    expect(collect).toContain("steps.publish_checkpoint.outcome == 'skipped'");
    expect(collect).toContain("!cancelled()");
    expect(collect).not.toContain("outcome == 'cancelled'");
    expect(batch.indexOf("Publish collected results")).toBeLessThan(
      batch.indexOf("Fail when checkpoint publish failed")
    );
    expect(entry).toContain('cron: "47 * * * *"');
    expect(entry).toContain("workflow_dispatch:");
    expect(entry).not.toContain("queue.ndjson");
    expect(entry).not.toContain("\n  push:");
    expect(entry).not.toContain("batch-run.yml");
    expect(entry.match(/concurrency:/g)).toHaveLength(1);
    expect(entry.match(/uses: actions\/checkout@/g)).toHaveLength(1);
    expect(entry.match(/uses: \.\/\.github\/actions\/setup-jobradar/g)).toHaveLength(1);
    expect(jobs).toContain("uses: ./.github/actions/batch-work");
    expect(jobs).not.toContain("batch-run.yml");
    expect(jobs).not.toContain("needs.publish.result == 'failure'");
    expect(jobs.match(/always\(\)/g)).toEqual(["always()"]);
    expect(jobs).toContain("name: Write run summary\n        if: ${{ always() && !cancelled() }}");
    expect(issue).toContain("uses: ./.github/actions/batch-work");
    expect(issue).toContain("needs.process.result == 'failure'");
    expect(issue).not.toContain("batch-run.yml");
    expect(collectShouldContinue("success", "success")).toBe(true);
    expect(collectShouldContinue("success", "failure")).toBe(true);
    expect(collectShouldContinue("success", "skipped")).toBe(true);
    expect(collectShouldContinue("success", "cancelled")).toBe(false);
    expect(collectShouldContinue("failure", "skipped")).toBe(false);
  });

  it("uses queue and inflight for a manual caller and keeps Jobs successful when idle", () => {
    const batch = workflow("batch.yml");
    const jobs = workflow("jobs.yml");

    expect(batchDue("workflow_dispatch", null, null)).toBe(false);
    expect(batchDue("workflow_dispatch", "", "[]")).toBe(false);
    expect(batchDue("workflow_dispatch", "\n  \n", "[]")).toBe(false);
    expect(batchDue("workflow_dispatch", "job\n", "[]")).toBe(true);
    expect(batchDue("workflow_dispatch", "job\n", null)).toBe(true);
    expect(batchDue("workflow_dispatch", "", '[{"id":"batch"}]')).toBe(true);
    expect(batchDue("workflow_dispatch", null, '[{"id":"batch"}]')).toBe(true);
    expect(batch).toContain("steps.check.outputs.due == 'true'");
    expect(jobs).toContain("steps.batch_due.outputs.due == 'true'");
    expect(jobs).toContain(
      "steps.publish.outcome == 'success' || steps.publish.outcome == 'skipped'"
    );
    expect(jobs.indexOf("Publish saved data")).toBeLessThan(jobs.indexOf("Run batch"));
    expect(jobs.indexOf("Record saved data commit")).toBeGreaterThan(
      jobs.indexOf("Rebase and push data")
    );
    expect(jobsResultAfterBatch("success", "success", "success")).toBe("success");
    expect(jobsResultAfterBatch("success", "skipped", "success")).toBe("success");
    expect(jobsResultAfterBatch("success", "failure", "skipped")).toBe("failure");
    expect(jobsResultAfterBatch("success", "success", "failure")).toBe("failure");
    expect(jobs.match(/uses: actions\/checkout@/g)).toHaveLength(1);
    expect(jobs.match(/uses: \.\/\.github\/actions\/setup-jobradar/g)).toHaveLength(1);
    expect(jobs).toContain("fetch-depth: 1");
    expect(jobs).not.toContain("fetch-depth: 0");
    expect(jobs).toContain("steps.calendar.outputs.should_run == 'true'");
    expect(workflow("publish-data.yml").match(/uses: actions\/checkout@/g)).toHaveLength(1);
    expect(workflow("publish-data.yml")).toContain("fetch-depth: 0");
    expect(workflow("publish-jobs.yml").match(/uses: actions\/checkout@/g)).toHaveLength(1);
    expect(workflow("add-job-from-issue.yml").match(/uses: actions\/checkout@/g)).toHaveLength(1);
  });

  it("fetches history only when a commit, parent, or merge base is missing", () => {
    const ready = {
      shallow: true,
      commitPresent: true,
      parentRequired: true,
      parentPresent: true,
      fetched: false,
    };
    expect(commitHistoryPlan(ready)).toBe("ready");
    expect(commitHistoryPlan({ ...ready, parentPresent: false })).toBe("fetch");
    expect(commitHistoryPlan({ ...ready, parentPresent: false, fetched: true })).toBe("unshallow");
    expect(
      commitHistoryPlan({ ...ready, shallow: false, parentPresent: false, fetched: true })
    ).toBe("fail");
    expect(commitHistoryPlan({ ...ready, commitPresent: false, parentRequired: false })).toBe(
      "fetch"
    );
    expect(rebaseHistoryPlan({ shallow: false, mergeBasePresent: true, unshallowed: false })).toBe(
      "ready"
    );
    expect(rebaseHistoryPlan({ shallow: true, mergeBasePresent: false, unshallowed: false })).toBe(
      "unshallow"
    );
    expect(rebaseHistoryPlan({ shallow: true, mergeBasePresent: false, unshallowed: true })).toBe(
      "fail"
    );
    expect(rebaseHistoryPlan({ shallow: false, mergeBasePresent: false, unshallowed: false })).toBe(
      "fail"
    );
    expect(action("rebase-push")).toContain('echo "No common ancestor');
    expect(action("rebase-push")).not.toContain("force");
    expect(action("publish-saved")).toContain("Notification was not sent.");
    expect(action("publish-saved")).toContain("4b825dc642cb6eb9a060e54bf8d69288fbee4904");
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

    const isolated = isolatedRouteEnv(directory, {
      EVENT_NAME: "workflow_dispatch",
      TASK: "board refresh",
    });
    const committed = spawnSync(process.execPath, [ROUTE, "maintenance-commit"], {
      cwd: directory,
      encoding: "utf8",
      env: isolated.env,
    });

    expect(committed.status, committed.stderr).toBe(0);
    expect(readFileSync(isolated.summary, "utf8")).toBe("OFFICIAL\n");
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

function isolatedRouteEnv(directory: string, extra: Record<string, string> = {}) {
  const inherited = { ...process.env };
  delete inherited.GITHUB_OUTPUT;
  delete inherited.GITHUB_STEP_SUMMARY;
  delete inherited.JOBRADAR_SUMMARY_DIR;
  const summary = path.join(directory, "official-step-summary.md");
  const stageDir = path.join(directory, "summary-stages");
  writeFileSync(summary, "OFFICIAL\n");
  return {
    summary,
    stageDir,
    env: {
      ...inherited,
      ...extra,
      GITHUB_STEP_SUMMARY: summary,
      JOBRADAR_SUMMARY_DIR: stageDir,
    },
  };
}

function publishRoute(directory: string, env: Record<string, string>) {
  const isolated = isolatedRouteEnv(directory, env);
  const result = spawnSync(process.execPath, [ROUTE, "publish-route"], {
    cwd: directory,
    encoding: "utf8",
    env: isolated.env,
  });
  expect(readFileSync(isolated.summary, "utf8")).toBe("OFFICIAL\n");
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

    const isolated = isolatedRouteEnv(directory);
    const classified = spawnSync(process.execPath, [ROUTE, "classify-head"], {
      cwd: directory,
      encoding: "utf8",
      env: isolated.env,
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
      env: isolated.env,
    });
    expect(readFileSync(isolated.summary, "utf8")).toBe("OFFICIAL\n");
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
    const isolated = isolatedRouteEnv(directory);
    const failed = spawnSync(process.execPath, [ROUTE, "publish-route"], {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...isolated.env,
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
    expect(readFileSync(isolated.summary, "utf8")).toBe("OFFICIAL\n");
    const stages = readFileSync(path.join(isolated.stageDir, "stages.ndjson"), "utf8");
    expect(stages).toContain("2048");
    expect(stages).toContain("Notification was not sent.");

    const rendered = path.join(directory, "rendered-summary.md");
    const render = spawnSync(
      process.execPath,
      [path.join(ROOT, ".github/scripts/summary.mjs"), "render"],
      {
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          JOBRADAR_SUMMARY_DIR: isolated.stageDir,
          GITHUB_STEP_SUMMARY: rendered,
        },
      }
    );
    expect(render.status).toBe(0);
    expect(readFileSync(rendered, "utf8")).toContain("2048");
    expect(readFileSync(isolated.summary, "utf8")).toBe("OFFICIAL\n");

    const missingParent = "e".repeat(40);
    const missing = spawnSync(process.execPath, [ROUTE, "publish-route"], {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...isolated.env,
        BEFORE: ZERO_SHA,
        SHA: after,
        COMMIT_MESSAGE: "add a job",
        PUSH_COMMITS: JSON.stringify([missingParent]),
      },
    });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("could not be resolved");
    expect(missing.stdout).not.toContain("notify=");
    expect(readFileSync(isolated.summary, "utf8")).toBe("OFFICIAL\n");
    const missingStages = readFileSync(path.join(isolated.stageDir, "stages.ndjson"), "utf8");
    expect(missingStages).toContain(missingParent);
    expect(missingStages).toContain("could not be resolved");
    expect(readFileSync(rendered, "utf8")).not.toContain(missingParent);
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
    expect(workflow("publish-data.yml")).toContain("from_sha: ${{ steps.route.outputs.from_sha }}");
  });

  it("passes secrets into composite actions and keeps the outer job deadline", () => {
    const secretEnv = [
      "SMTP_PASS: ${{ secrets.SMTP_PASS }}",
      "AI_API_KEY: ${{ secrets.AI_API_KEY }}",
      "PAT: ${{ secrets.PAT }}",
    ];
    const callers = [
      ["jobs.yml", 2],
      ["batch.yml", 1],
      ["add-job-from-issue.yml", 2],
      ["publish-data.yml", 1],
      ["publish-jobs.yml", 1],
    ] as const;

    for (const [name, count] of callers) {
      const blocks = stepBlocks(workflow(name)).filter(
        (block) =>
          block.includes("uses: ./.github/actions/publish-saved") ||
          block.includes("uses: ./.github/actions/batch-work")
      );
      expect(blocks, name).toHaveLength(count);
      for (const block of blocks) {
        for (const line of secretEnv) expect(block, `${name} ${line}`).toContain(line);
      }
    }

    expect(workflow("jobs.yml")).toContain("timeout-minutes: 175");
    expect(workflow("batch.yml")).toContain("timeout-minutes: 120");
    expect(workflow("add-job-from-issue.yml")).toContain("timeout-minutes: 150");
    expect(workflow("publish-data.yml")).toContain("timeout-minutes: 30");
    expect(workflow("publish-jobs.yml")).toContain("timeout-minutes: 25");

    for (const name of ["jobs.yml", "batch.yml", "publish-jobs.yml", "publish-data.yml", "maintenance.yml"]) {
      expect(workflow(name)).toContain("JOBRADAR_SUMMARY_DIR:");
      expect(workflow(name)).toContain("JOB_STATUS: ${{ job.status }}");
      expect(workflow(name)).toContain("node .github/scripts/summary.mjs render");
      expect(workflow(name)).toContain("always() && !cancelled()");
    }
    expect(action("publish-saved")).not.toContain("summary.mjs render");
    expect(action("batch-work")).not.toContain("summary.mjs render");
    expect(action("refresh-board")).not.toContain("summary.mjs render");
  });
});
