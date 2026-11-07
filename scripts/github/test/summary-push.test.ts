import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.hoisted(() => vi.fn(async () => ({})));
const getNewJobsFromDiff = vi.hoisted(() => vi.fn());

vi.mock("@/config", () => ({
  CONFIG: {
    dashboard: { notify: true },
    sender: { email: "from@example.com" },
    receiver: { emails: ["one@example.com"] },
  },
}));
vi.mock("../../utils/mail", () => ({
  createSMTPTransport: () => ({ close() {}, sendMail }),
}));
vi.mock("../../command/notify/git", () => ({ getNewJobsFromDiff }));
vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import notifyRange from "../../command/notify/range";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const SUMMARY = path.join(ROOT, ".github/scripts/summary.mjs");
const temps: string[] = [];

afterEach(() => {
  getNewJobsFromDiff.mockReset();
  sendMail.mockReset();
  sendMail.mockImplementation(async () => ({}));
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function gitEnv(extra: Record<string, string> = {}) {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Summary Test",
    GIT_AUTHOR_EMAIL: "summary@example.com",
    GIT_COMMITTER_NAME: "Summary Test",
    GIT_COMMITTER_EMAIL: "summary@example.com",
    GIT_TERMINAL_PROMPT: "0",
    ...extra,
  };
}

function git(cwd: string, args: string[]) {
  return spawnSync("git", args, { cwd, encoding: "utf8", env: gitEnv() });
}

function summaryCli(args: string[], env: Record<string, string>) {
  return spawnSync(process.execPath, [SUMMARY, ...args], { encoding: "utf8", env: gitEnv(env) });
}

function rejectingRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "jobradar-summary-push-"));
  temps.push(dir);
  const work = path.join(dir, "work");
  const bare = path.join(dir, "origin.git");
  const stages = path.join(dir, "stages");
  mkdirSync(work);
  expect(git(dir, ["init", "--bare", "-b", "main", bare]).status).toBe(0);
  writeFileSync(path.join(bare, "hooks/pre-receive"), "#!/bin/sh\necho rejected by test hook >&2\nexit 1\n");
  chmodSync(path.join(bare, "hooks/pre-receive"), 0o755);
  expect(git(dir, ["init", "-b", "main", work]).status).toBe(0);
  writeFileSync(path.join(work, "jobs.txt"), "local jobs\n");
  expect(git(work, ["add", "jobs.txt"]).status).toBe(0);
  expect(git(work, ["commit", "-m", "chore(discovery): update new jobs"]).status).toBe(0);
  expect(git(work, ["remote", "add", "origin", bare]).status).toBe(0);
  const local = git(work, ["rev-parse", "HEAD"]);
  expect(local.status).toBe(0);
  return { dir, work, bare, stages, local: local.stdout.trim() };
}

function rejectedPush(work: string) {
  return git(work, ["-c", "protocol.file.allow=always", "push", "origin", "HEAD:main"]);
}

function remoteTip(bare: string) {
  return git(bare, ["rev-parse", "--verify", "refs/heads/main"]);
}

function render(stages: string, name: string) {
  const summaryPath = path.join(path.dirname(stages), `${name}.md`);
  const rendered = summaryCli(["render"], {
    JOBRADAR_SUMMARY_DIR: stages,
    GITHUB_STEP_SUMMARY: summaryPath,
    JOB_STATUS: "failure",
  });
  expect(rendered.status).toBe(0);
  return readFileSync(summaryPath, "utf8");
}

describe("summary push results", () => {
  it("keeps a rejected push failed after the local commit succeeds", () => {
    const repo = rejectingRepo();
    const committed = summaryCli(["append-commit"], {
      JOBRADAR_SUMMARY_DIR: repo.stages,
      COMMIT_LABEL: "job data",
    });
    expect(committed.status).toBe(0);

    const push = rejectedPush(repo.work);
    expect(push.status).not.toBe(0);
    expect(push.stderr).toContain("rejected by test hook");
    expect(remoteTip(repo.bare).status).not.toBe(0);
    expect(git(repo.work, ["rev-parse", "HEAD"]).stdout.trim()).toBe(repo.local);

    const recorded = summaryCli(["append-push"], {
      JOBRADAR_SUMMARY_DIR: repo.stages,
      PUSH_LABEL: "job data",
      PUSH_STATUS: "failure",
    });
    expect(recorded.status).toBe(0);

    const markdown = render(repo.stages, "push-rejected");
    expect(markdown).toContain("### Commit (job data)");
    expect(markdown).toContain("| Committed | yes |");
    expect(markdown).toContain("### Push (job data)");
    expect(markdown).toContain("| Status | failed |");
    expect(markdown).toContain("| Pushed | no |");
    expect(markdown).toContain("| Reason | push did not succeed |");
    expect(markdown).not.toContain("| Pushed | yes |");
    expect(markdown).toContain("This run failed");
    expect(markdown).toContain("Data is on the remote only when a push table says yes");

    const official = path.join(repo.dir, "official.md");
    writeFileSync(official, "OFFICIAL\n");
    const blocked = path.join(repo.dir, "blocked");
    writeFileSync(blocked, "kept");
    const failedWrite = summaryCli(["append-push"], {
      JOBRADAR_SUMMARY_DIR: blocked,
      GITHUB_STEP_SUMMARY: official,
      PUSH_LABEL: "job data",
      PUSH_STATUS: "failure",
    });
    expect(failedWrite.status).toBe(0);
    expect(failedWrite.stderr).toContain("The task result is unchanged");
    expect(push.status).not.toBe(0);
    expect(remoteTip(repo.bare).status).not.toBe(0);
    expect(readFileSync(official, "utf8")).toBe("OFFICIAL\n");
    expect(readFileSync(blocked, "utf8")).toBe("kept");
  });

  it("does not treat a committed recovery as saved on the remote when push is rejected", () => {
    const repo = rejectingRepo();
    const recovered = summaryCli(["append-recover"], {
      JOBRADAR_SUMMARY_DIR: repo.stages,
      RECOVER_STATUS: "0",
      RECOVER_OUTPUT: "committed=true\n",
    });
    expect(recovered.status).toBe(0);

    const push = rejectedPush(repo.work);
    expect(push.status).not.toBe(0);
    expect(remoteTip(repo.bare).status).not.toBe(0);

    const recorded = summaryCli(["append-push"], {
      JOBRADAR_SUMMARY_DIR: repo.stages,
      PUSH_LABEL: "batch recovery",
      PUSH_STATUS: push.status === 0 ? "success" : "failure",
    });
    expect(recorded.status).toBe(0);

    const markdown = render(repo.stages, "recovery-push-rejected");
    expect(markdown).toContain("### Batch recovery");
    expect(markdown).toContain("| Committed | yes |");
    expect(markdown).toContain("| Written locally | local |");
    expect(markdown).toContain("### Push (batch recovery)");
    expect(markdown).toContain("| Pushed | no |");
    expect(markdown).toContain("| Status | failed |");
    expect(markdown).not.toContain("| Pushed | yes |");
    expect(markdown).not.toContain("checkpoint committed");
    expect(markdown).toContain("This run failed");
    expect(git(repo.work, ["rev-parse", "HEAD"]).stdout.trim()).toBe(repo.local);
  });

  it("keeps a failed board push and a successful notification separate", async () => {
    const repo = rejectingRepo();
    const board = summaryCli(
      ["append", '{"stage":"board-commit","status":"success","committed":true}'],
      { JOBRADAR_SUMMARY_DIR: repo.stages }
    );
    expect(board.status).toBe(0);

    const push = rejectedPush(repo.work);
    expect(push.status).not.toBe(0);
    const recorded = summaryCli(["append-push"], {
      JOBRADAR_SUMMARY_DIR: repo.stages,
      PUSH_LABEL: "board",
      PUSH_STATUS: "failure",
    });
    expect(recorded.status).toBe(0);

    getNewJobsFromDiff.mockReturnValue([
      { company: "Acme", role: "Secret Role", link: "https://example.com/full-jd" },
    ]);
    process.env.JOBRADAR_SUMMARY_DIR = repo.stages;
    try {
      await notifyRange("a".repeat(40), "b".repeat(40));
    } finally {
      delete process.env.JOBRADAR_SUMMARY_DIR;
    }

    const markdown = render(repo.stages, "board-push-notify");
    expect(markdown).toContain("### Board commit");
    expect(markdown).toContain("| Committed | yes |");
    expect(markdown).toContain("### Push (board)");
    expect(markdown).toContain("| Pushed | no |");
    expect(markdown).toContain("### Notify");
    expect(markdown).toContain("| Status | success |");
    expect(markdown).toContain("| Jobs notified | 1 |");
    expect(markdown).not.toContain("| Pushed | yes |");
    expect(markdown).not.toContain("Emails sent");
    expect(markdown).not.toContain("one@example.com");
    expect(markdown).not.toContain("Secret Role");
    expect(markdown).toContain("This run failed");
    expect(markdown.indexOf("### Push (board)")).toBeLessThan(markdown.indexOf("### Notify"));
    expect(remoteTip(repo.bare).status).not.toBe(0);
  });
});
