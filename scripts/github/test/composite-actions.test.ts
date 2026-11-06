import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";

import {
  batchConclusion,
  shouldNotify,
  shouldStartWrite,
} from "../../../.github/scripts/workflow-route.mjs";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const ROUTE = path.join(ROOT, ".github/scripts/workflow-route.mjs");
const DEADLINE = path.join(ROOT, ".github/scripts/run-deadline.mjs");
const RESTORE = path.join(ROOT, ".github/scripts/restore-board-attempt.mjs");
const USE_PUSH_TOKEN = path.join(ROOT, ".github/scripts/use-push-token.sh");

const temps: string[] = [];
const leftoverPids: number[] = [];
const pidFiles: string[] = [];

function readPids(file: string) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => Number(line))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

function killPid(pid: number) {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // This pid is not a live process group.
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // The process has already exited.
  }
}

function processAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function resistantParent(marker: string, pidFile: string) {
  const grandchild =
    "process.on('SIGTERM', () => {}); process.on('SIGINT', () => {});" +
    `setInterval(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(Date.now())), 30);`;
  return `
    const fs = require("node:fs");
    const { spawn } = require("node:child_process");
    const child = spawn(process.execPath, ["-e", ${JSON.stringify(grandchild)}], { stdio: "ignore" });
    fs.writeFileSync(${JSON.stringify(pidFile)}, process.pid + "\\n" + child.pid + "\\n");
    setInterval(() => {}, 1000);
  `;
}

function waitForExit(child: ChildProcess, timeoutMs: number) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
  return new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("wrapper exceeded the test bound")), timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function stopFromSignal(signal: "SIGTERM" | "SIGINT", status: number) {
  const root = mkdtempSync(path.join(tmpdir(), "jobradar-cancel-"));
  temps.push(root);
  const marker = path.join(root, "alive");
  const pidFile = path.join(root, "pids");
  pidFiles.push(pidFile);
  const wrapper = spawn(process.execPath, [DEADLINE, "30", process.execPath, "-e", resistantParent(marker, pidFile)], {
    env: { ...gitEnv(), JOBRADAR_KILL_AFTER_MS: "200" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (wrapper.pid) leftoverPids.push(wrapper.pid);
  let stderr = "";
  wrapper.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const pending = waitForExit(wrapper, 8000);
  try {
    const started = Date.now();
    while (!existsSync(marker)) {
      if (wrapper.exitCode !== null || Date.now() - started > 2000) break;
      await delay(20);
    }
    expect(existsSync(marker), stderr).toBe(true);
    try {
      wrapper.kill(signal);
    } catch {
      // The wrapper already exited.
    }
    try {
      wrapper.kill(signal);
    } catch {
      // A repeated signal must not start another stop.
    }
    expect(await pending).toBe(status);
    expect(stderr).not.toContain("exceeded");
    const grandchild = readPids(pidFile)[1] ?? 0;
    expect(grandchild).toBeGreaterThan(0);
    expect(processAlive(grandchild)).toBe(false);
    const first = readFileSync(marker, "utf8");
    await delay(250);
    expect(readFileSync(marker, "utf8")).toBe(first);
  } finally {
    if (wrapper.pid) killPid(wrapper.pid);
    for (const pid of readPids(pidFile)) killPid(pid);
  }
}

afterEach(() => {
  for (const file of pidFiles.splice(0)) {
    for (const pid of readPids(file)) leftoverPids.push(pid);
  }
  for (const pid of leftoverPids.splice(0)) killPid(pid);
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function actionText(name: string) {
  return readFileSync(path.join(ROOT, ".github/actions", name, "action.yml"), "utf8");
}

function blocksAt(source: string, indent: string) {
  const blocks: string[] = [];
  let current: string[] | null = null;
  for (const line of source.split("\n")) {
    if (line.startsWith(`${indent}- `)) {
      if (current) blocks.push(current.join("\n"));
      current = [line];
      continue;
    }
    if (current) current.push(line);
  }
  if (current) blocks.push(current.join("\n"));
  return blocks;
}

function gitEnv() {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

function git(cwd: string, args: string[]) {
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", "-c", "protocol.file.allow=always", ...args], {
    cwd,
    encoding: "utf8",
    env: gitEnv(),
  });
  if (result.status !== 0) {
    throw new Error(`${args.join(" ")}\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function gitResult(cwd: string, args: string[]) {
  return spawnSync("git", ["-c", "commit.gpgsign=false", "-c", "protocol.file.allow=always", ...args], {
    cwd,
    encoding: "utf8",
    env: gitEnv(),
  });
}

function createRepo() {
  const root = mkdtempSync(path.join(tmpdir(), "jobradar-board-"));
  temps.push(root);
  const origin = path.join(root, "origin.git");
  const work = path.join(root, "work");
  git(root, ["init", "--bare", "-b", "main", origin]);
  git(root, ["init", "-b", "main", work]);
  git(work, ["config", "user.name", "actions-bot"]);
  git(work, ["config", "user.email", "actions@github.com"]);
  git(work, ["config", "commit.gpgsign", "false"]);
  git(work, ["config", "protocol.file.allow", "always"]);
  mkdirSync(path.join(work, "data"));
  writeFileSync(path.join(work, "data", "jobs.ndjson"), "checkpoint\n");
  writeFileSync(path.join(work, "README.md"), "board-base\n");
  git(work, ["add", "data", "README.md"]);
  git(work, ["commit", "-m", "chore(batch): checkpoint inflight submissions [skip ci]"]);
  git(work, ["remote", "add", "origin", origin]);
  git(work, ["push", "-u", "origin", "main"]);
  return { root, origin, work, base: git(work, ["rev-parse", "HEAD"]) };
}

function restore(repo: { work: string; base: string }) {
  return spawnSync(process.execPath, [RESTORE], {
    cwd: repo.work,
    encoding: "utf8",
    env: { ...gitEnv(), BASE_SHA: repo.base, BRANCH: "main" },
  });
}

function collectAndPush(work: string) {
  git(work, ["add", "data"]);
  git(work, ["commit", "-m", "chore(batch): collect batch analysis"]);
  const rebase = gitResult(work, ["rebase", "origin/main"]);
  expect(rebase.status, rebase.stderr).toBe(0);
  git(work, ["push", "origin", "HEAD:main"]);
}

describe("composite actions", () => {
  it("uses workspace paths and the env context, with a real deadline and no secrets context", () => {
    const names = ["batch-work", "publish-saved", "rebase-push", "refresh-board", "setup-jobradar"];
    for (const name of names) {
      const text = actionText(name);
      expect(text, name).not.toMatch(/secrets\./);
      expect(text, name).not.toMatch(/timeout-minutes/);
      expect(text, name).not.toMatch(/uses:\s+\.\.\//);
      expect(text, name).not.toMatch(/echo\s+.*\$(SMTP_PASS|AI_API_KEY|PAT|TOKEN)\b/);
      for (const match of text.matchAll(/^\s*uses:\s*(\S+)\s*$/gm)) {
        const use = match[1] ?? "";
        if (!use.startsWith(".")) continue;
        expect(use, name).toMatch(/^\.\/\.github\/actions\/[A-Za-z0-9-]+$/);
        expect(existsSync(path.join(ROOT, use, "action.yml")), use).toBe(true);
      }
    }

    const publish = actionText("publish-saved");
    const batch = actionText("batch-work");
    const refresh = actionText("refresh-board");
    expect(publish).toContain("run-deadline.mjs 300");
    expect(publish).toContain("run-deadline.mjs 600");
    expect(publish).toContain("uses: ./.github/actions/refresh-board");
    expect(publish).toContain("uses: ./.github/actions/rebase-push");
    expect(publish).toContain("continue-on-error: true");
    expect(refresh).toContain("run-deadline.mjs 600");
    expect(batch).toContain("run-deadline.mjs 1800");
    expect(batch).toContain("continue-on-error: true");

    const nested = blocksAt(batch, "    ").filter((block) =>
      block.includes("uses: ./.github/actions/publish-saved")
    );
    expect(nested).toHaveLength(2);
    for (const block of nested) {
      expect(block).toContain("SMTP_PASS: ${{ env.SMTP_PASS }}");
      expect(block).toContain("AI_API_KEY: ${{ env.AI_API_KEY }}");
      expect(block).toContain("PAT: ${{ env.PAT }}");
    }
    const notify = blocksAt(publish, "    ").find((block) => block.includes("Notify the saved range"));
    expect(notify).toContain("SMTP_PASS: ${{ env.SMTP_PASS }}");
    expect(notify).toContain("!cancelled()");

    const source = readFileSync(RESTORE, "utf8");
    expect(source).not.toMatch(/reset\s+--hard\b/);
    expect(source).not.toMatch(/git\s+clean\b/);
    expect(source).not.toMatch(/git\s+stash\b/);
    expect(source).toContain('["reset", "--keep", remote]');
  });

  it("drops the checkout v6 includeIf PAT before each batch push token", () => {
    const root = mkdtempSync(path.join(tmpdir(), "jobradar-token-"));
    temps.push(root);
    const work = path.join(root, "work");
    const credentials = path.join(root, "git-credentials-11111111-2222-4333-8444-555555555555.config");
    const containerCredentials =
      "/github/runner_temp/git-credentials-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.config";
    const kept = path.join(root, "kept.config");
    git(root, ["init", "-b", "main", work]);
    const gitDir = git(work, ["rev-parse", "--absolute-git-dir"]).replaceAll("\\", "/");
    git(work, ["remote", "add", "origin", "https://github.com/Donkey0322/JobRadar-AI.git"]);
    writeFileSync(credentials, "");
    writeFileSync(kept, "");
    git(work, [
      "config",
      "--file",
      credentials,
      "http.https://github.com/.extraheader",
      "AUTHORIZATION: basic checkout-pat",
    ]);
    git(work, ["config", "--file", kept, "user.email", "kept@example.com"]);
    git(work, ["config", "--local", `includeIf.gitdir:${gitDir}.path`, credentials]);
    git(work, ["config", "--local", "includeIf.gitdir:/github/workspace/.git.path", containerCredentials]);
    git(work, ["config", "--local", "includeIf.gitdir:**/.git.path", kept]);
    git(work, [
      "config",
      "--local",
      "http.https://github.com/.extraheader",
      "AUTHORIZATION: basic checkout-pat",
    ]);

    git(work, ["config", "--local", "--unset-all", "http.https://github.com/.extraheader"]);
    const leaked = git(work, ["config", "--includes", "--get-all", "http.https://github.com/.extraheader"]);
    expect(leaked).toContain("AUTHORIZATION: basic checkout-pat");
    const localOnly = gitResult(work, ["config", "--local", "--get-regexp", "extraheader"]);
    expect(localOnly.status).not.toBe(0);

    const apply = (token: string) => {
      const applied = spawnSync("bash", [USE_PUSH_TOKEN, token, "Donkey0322/JobRadar-AI"], {
        cwd: work,
        encoding: "utf8",
        env: gitEnv(),
      });
      expect(applied.status, applied.stderr).toBe(0);
      expect(applied.stdout).not.toContain(token);
      expect(applied.stdout).not.toContain("checkout-pat");
      return applied;
    };

    apply("built-in-token");
    const dataHeader = gitResult(work, [
      "config",
      "--includes",
      "--get-all",
      "http.https://github.com/.extraheader",
    ]);
    expect(`${dataHeader.stdout}${dataHeader.stderr}`).not.toContain("checkout-pat");
    expect(dataHeader.stdout).not.toContain("AUTHORIZATION:");
    expect(git(work, ["remote", "get-url", "origin"])).toBe(
      "https://x-access-token:built-in-token@github.com/Donkey0322/JobRadar-AI.git"
    );
    expect(git(work, ["config", "--includes", "--get", "user.email"])).toBe("kept@example.com");
    expect(existsSync(credentials)).toBe(false);

    apply("board-pat");
    const boardHeader = gitResult(work, [
      "config",
      "--includes",
      "--get-all",
      "http.https://github.com/.extraheader",
    ]);
    expect(`${boardHeader.stdout}${boardHeader.stderr}`).not.toContain("checkout-pat");
    expect(boardHeader.stdout).not.toContain("built-in-token");
    expect(boardHeader.stdout).not.toContain("AUTHORIZATION:");
    expect(git(work, ["remote", "get-url", "origin"])).toBe(
      "https://x-access-token:board-pat@github.com/Donkey0322/JobRadar-AI.git"
    );
  });

  it("stops the command group at the deadline and keeps the command status", () => {
    const quick = spawnSync(
      process.execPath,
      [DEADLINE, "5", process.execPath, "-e", "process.stdout.write('hello-deadline'); process.exit(3)"],
      {
        encoding: "utf8",
        timeout: 3000,
        killSignal: "SIGKILL",
        env: { ...gitEnv(), JOBRADAR_KILL_AFTER_MS: "5000" },
      }
    );
    expect(quick.status).toBe(3);
    expect(quick.stdout).toContain("hello-deadline");

    const root = mkdtempSync(path.join(tmpdir(), "jobradar-deadline-"));
    temps.push(root);
    const marker = path.join(root, "alive");
    const pidFile = path.join(root, "pids");
    pidFiles.push(pidFile);
    let stopped: ReturnType<typeof spawnSync> | undefined;
    try {
      stopped = spawnSync(
        process.execPath,
        [DEADLINE, "1", process.execPath, "-e", resistantParent(marker, pidFile)],
        {
          encoding: "utf8",
          timeout: 8000,
          killSignal: "SIGKILL",
          env: { ...gitEnv(), JOBRADAR_KILL_AFTER_MS: "200" },
        }
      );
      expect(stopped.status).toBe(124);
      expect(stopped.stderr).toContain("Step exceeded 1s and was stopped.");
      const grandchild = readPids(pidFile)[1] ?? 0;
      expect(grandchild).toBeGreaterThan(0);
      expect(processAlive(grandchild)).toBe(false);
      expect(existsSync(marker)).toBe(true);
      const first = readFileSync(marker, "utf8");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
      expect(readFileSync(marker, "utf8")).toBe(first);
    } finally {
      for (const pid of readPids(pidFile)) killPid(pid);
    }

    const directPid = path.join(root, "direct");
    pidFiles.push(directPid);
    const resistant = spawnSync(
      process.execPath,
      [
        DEADLINE,
        "1",
        process.execPath,
        "-e",
        `process.on("SIGTERM", () => {}); require("node:fs").writeFileSync(${JSON.stringify(directPid)}, process.pid + "\\n"); setInterval(() => {}, 1000);`,
      ],
      {
        encoding: "utf8",
        timeout: 8000,
        killSignal: "SIGKILL",
        env: { ...gitEnv(), JOBRADAR_KILL_AFTER_MS: "200" },
      }
    );
    try {
      expect(resistant.status).toBe(124);
      expect(resistant.stderr).toContain("Step exceeded 1s and was stopped.");
      expect(processAlive(readPids(directPid)[0] ?? 0)).toBe(false);
    } finally {
      for (const pid of readPids(directPid)) killPid(pid);
    }
  });

  it("stops the group when the wrapper receives SIGTERM or SIGINT", async () => {
    await stopFromSignal("SIGTERM", 143);
    await stopFromSignal("SIGINT", 130);
  });
});

describe("board restore and batch conclusion", () => {
  it("lets collect rebase and push after a partial board write", () => {
    const repo = createRepo();
    writeFileSync(path.join(repo.work, "README.md"), "partial board\n");
    mkdirSync(path.join(repo.work, "job-postings"));
    writeFileSync(path.join(repo.work, "job-postings", "partial.md"), "partial\n");
    writeFileSync(path.join(repo.work, "data", "jobs.ndjson"), "checkpoint\npending\n");

    const blocked = gitResult(repo.work, ["rebase", "origin/main"]);
    expect(blocked.status).not.toBe(0);

    const saved = git(repo.work, ["show", `${repo.base}:data/jobs.ndjson`]);
    expect(saved).toBe("checkpoint");
    expect(readFileSync(path.join(repo.work, "README.md"), "utf8")).toBe("partial board\n");

    const restored = restore(repo);
    expect(restored.status, restored.stderr).toBe(0);
    expect(readFileSync(path.join(repo.work, "README.md"), "utf8")).toBe("board-base\n");
    expect(existsSync(path.join(repo.work, "job-postings", "partial.md"))).toBe(false);
    expect(readFileSync(path.join(repo.work, "data", "jobs.ndjson"), "utf8")).toBe("checkpoint\npending\n");
    expect(git(repo.work, ["rev-parse", "HEAD"])).toBe(repo.base);

    collectAndPush(repo.work);
    expect(git(repo.origin, ["show", "main:README.md"])).toBe("board-base");
    expect(git(repo.origin, ["show", "main:data/jobs.ndjson"])).toBe("checkpoint\npending");
    expect(git(repo.work, ["show", `${repo.base}:data/jobs.ndjson`])).toBe("checkpoint");
    expect(gitResult(repo.work, ["merge-base", "--is-ancestor", repo.base, "HEAD"]).status).toBe(0);
    expect(git(repo.origin, ["log", "--format=%s", "main"])).not.toContain(
      "docs: update generated job boards"
    );
  });

  it("drops an unpushed board commit and still pushes the collect commit", () => {
    const repo = createRepo();
    writeFileSync(path.join(repo.work, "README.md"), "board-commit\n");
    git(repo.work, ["add", "README.md"]);
    git(repo.work, ["commit", "-m", "docs: update generated job boards"]);
    const board = git(repo.work, ["rev-parse", "HEAD"]);
    writeFileSync(path.join(repo.work, "data", "jobs.ndjson"), "checkpoint\npending\n");

    const restored = restore(repo);
    expect(restored.status, restored.stderr).toBe(0);
    expect(git(repo.work, ["rev-parse", "HEAD"])).toBe(repo.base);
    expect(readFileSync(path.join(repo.work, "README.md"), "utf8")).toBe("board-base\n");
    expect(readFileSync(path.join(repo.work, "data", "jobs.ndjson"), "utf8")).toBe("checkpoint\npending\n");
    expect(gitResult(repo.work, ["merge-base", "--is-ancestor", board, "HEAD"]).status).not.toBe(0);

    collectAndPush(repo.work);
    expect(git(repo.origin, ["log", "--format=%s", "main"])).not.toContain(
      "docs: update generated job boards"
    );
    expect(git(repo.origin, ["show", "main:data/jobs.ndjson"])).toBe("checkpoint\npending");
    expect(git(repo.origin, ["show", "main:README.md"])).toBe("board-base");
    expect(git(repo.work, ["show", `${repo.base}:data/jobs.ndjson`])).toBe("checkpoint");
  });

  it("keeps a board commit that was already pushed", () => {
    const repo = createRepo();
    writeFileSync(path.join(repo.work, "README.md"), "published-board\n");
    git(repo.work, ["add", "README.md"]);
    git(repo.work, ["commit", "-m", "docs: update generated job boards"]);
    git(repo.work, ["push", "origin", "HEAD:main"]);
    const board = git(repo.work, ["rev-parse", "HEAD"]);

    const restored = restore(repo);
    expect(restored.status, restored.stderr).toBe(0);
    expect(git(repo.work, ["rev-parse", "HEAD"])).toBe(board);
    expect(git(repo.origin, ["show", "main:README.md"])).toBe("published-board");
    expect(gitResult(repo.work, ["merge-base", "--is-ancestor", repo.base, "HEAD"]).status).toBe(0);
  });

  it("refuses to drop an unpushed commit that is not a board commit or that edits data", () => {
    const other = createRepo();
    writeFileSync(path.join(other.work, "README.md"), "other\n");
    git(other.work, ["add", "README.md"]);
    git(other.work, ["commit", "-m", "chore: unrelated"]);
    const otherHead = git(other.work, ["rev-parse", "HEAD"]);
    const refused = restore(other);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("not board commits");
    expect(git(other.work, ["rev-parse", "HEAD"])).toBe(otherHead);

    const data = createRepo();
    writeFileSync(path.join(data.work, "README.md"), "board-commit\n");
    writeFileSync(path.join(data.work, "data", "jobs.ndjson"), "checkpoint\nchanged\n");
    git(data.work, ["add", "README.md", "data"]);
    git(data.work, ["commit", "-m", "docs: update generated job boards"]);
    const dataHead = git(data.work, ["rev-parse", "HEAD"]);
    const kept = restore(data);
    expect(kept.status).toBe(1);
    expect(kept.stderr).toContain("include data/");
    expect(git(data.work, ["rev-parse", "HEAD"])).toBe(dataHead);
    expect(git(data.work, ["show", "HEAD:data/jobs.ndjson"])).toBe("checkpoint\nchanged");
  });

  it("keeps a failed checkpoint publish failed after a later success, and does not start work after cancel", () => {
    expect(
      batchConclusion({
        checkpointPublish: "failure",
        collect: "success",
        collectPublish: "success",
      })
    ).toBe("failure");
    const failed = spawnSync(process.execPath, [ROUTE, "batch-conclusion"], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        CHECKPOINT_PUBLISH: "failure",
        COLLECT: "success",
        COLLECT_PUBLISH: "success",
      },
    });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("Checkpoint publish failed after collect.");

    const succeeded = spawnSync(process.execPath, [ROUTE, "batch-conclusion"], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        CHECKPOINT_PUBLISH: "success",
        COLLECT: "success",
        COLLECT_PUBLISH: "success",
      },
    });
    expect(succeeded.status).toBe(0);

    const cancelled = spawnSync(process.execPath, [ROUTE, "batch-conclusion"], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        CHECKPOINT_PUBLISH: "cancelled",
        COLLECT: "success",
        COLLECT_PUBLISH: "success",
      },
    });
    expect(cancelled.status).toBe(0);
    expect(cancelled.stderr).toContain("Cancelled. No further writes.");
    expect(cancelled.stderr).not.toContain("failed");

    const dir = mkdtempSync(path.join(tmpdir(), "jobradar-cancel-"));
    temps.push(dir);
    const notifyFile = path.join(dir, "notify.txt");
    const writeFile = path.join(dir, "write.txt");
    if (shouldNotify("failure", true, true, "success", true)) writeFileSync(notifyFile, "sent");
    if (shouldStartWrite(true)) writeFileSync(writeFile, "wrote");
    expect(existsSync(notifyFile)).toBe(false);
    expect(existsSync(writeFile)).toBe(false);
    expect(shouldNotify("failure", true, true, "success", false)).toBe(true);
    expect(shouldStartWrite(false)).toBe(true);

    const notify = spawnSync(process.execPath, [ROUTE, "should-start"], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        STEP: "notify",
        CANCELLED: "true",
        NOTIFY: "true",
        SEND: "true",
        BOARD: "failure",
      },
    });
    expect(notify.status).toBe(2);
    expect(notify.stderr).toContain("Cancelled. Notification was not sent.");
    const write = spawnSync(process.execPath, [ROUTE, "should-start"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", STEP: "write", CANCELLED: "true" },
    });
    expect(write.status).toBe(2);
    expect(write.stderr).toContain("Cancelled. No further writes.");
  });
});
