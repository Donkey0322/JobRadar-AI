/**
 * Drop unpublished board output from the shared worktree.
 * Tracked data and the saved commit stay. Unpushed commits are removed only
 * when every one is a board commit and the diff is limited to generated board
 * files. That branch move is `git reset --keep` back to the pushed tip.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, rmdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const BOARD_PATHS = ["README.md", "job-postings", "assets/featured-badges"];
export const BOARD_COMMIT_MESSAGE = "docs: update generated job boards";

function git(repo, args) {
  return spawnSync("git", args, { cwd: repo, encoding: "utf8" });
}

function gitText(repo, args) {
  const result = git(repo, args);
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
  }
  return (result.stdout || "").trim();
}

function isAncestor(repo, ancestor, descendant) {
  return git(repo, ["merge-base", "--is-ancestor", ancestor, descendant]).status === 0;
}

function assertBoardFile(repo, relative) {
  const full = path.resolve(repo, relative);
  const root = path.resolve(repo);
  if (full !== root && !full.startsWith(`${root}${path.sep}`)) {
    throw new Error(`refusing ${relative}`);
  }
  const normalized = path.relative(root, full);
  if (normalized === "data" || normalized.startsWith(`data${path.sep}`)) {
    throw new Error(`refusing data path ${normalized}`);
  }
  const allowed = BOARD_PATHS.some(
    (boardPath) => normalized === boardPath || normalized.startsWith(`${boardPath}${path.sep}`)
  );
  if (!allowed) throw new Error(`refusing ${normalized}`);
  return full;
}

function untrackedBoardFiles(repo) {
  const listed = gitText(repo, ["ls-files", "--others", "--exclude-standard", "--", ...BOARD_PATHS]);
  return listed ? listed.split("\n").filter(Boolean) : [];
}

function removeUntrackedBoardFiles(repo) {
  for (const relative of untrackedBoardFiles(repo)) {
    rmSync(assertBoardFile(repo, relative), { force: true });
  }
  for (const boardPath of BOARD_PATHS) {
    removeEmptyUntrackedDir(repo, boardPath);
  }
}

function removeEmptyUntrackedDir(repo, boardPath) {
  const root = path.join(repo, boardPath);
  if (!existsSync(root) || !statSync(root).isDirectory()) return;
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const child = path.join(dir, entry);
      if (statSync(child).isDirectory()) walk(child);
    }
    if (readdirSync(dir).length > 0) return;
    const relative = path.relative(repo, dir);
    const tracked = git(repo, ["ls-files", "--", relative]);
    if ((tracked.stdout || "").trim() !== "") return;
    assertBoardFile(repo, relative);
    rmdirSync(dir);
  };
  walk(root);
}

function restoreTrackedBoard(repo) {
  for (const boardPath of BOARD_PATHS) {
    const tracked = git(repo, ["ls-files", "--", boardPath]);
    if ((tracked.stdout || "").trim() === "") continue;
    gitText(repo, ["restore", "--source=HEAD", "--worktree", "--staged", "--", boardPath]);
  }
}

function remoteSha(repo, branch) {
  const result = git(repo, ["rev-parse", "--verify", "--quiet", `origin/${branch}`]);
  if (result.status !== 0) return "";
  return (result.stdout || "").trim();
}

export function restoreBoardAttempt(repo, { baseSha = "", branch }) {
  if (!branch || branch.startsWith("-") || !/^[A-Za-z0-9._/-]+$/.test(branch)) {
    throw new Error("branch is required");
  }
  if (baseSha && !/^[0-9a-f]{40}$/.test(baseSha)) throw new Error("base SHA is not a commit");
  if (baseSha && !isAncestor(repo, baseSha, "HEAD")) {
    throw new Error("Saved data commit is not in HEAD. Refusing to restore.");
  }

  const dataBefore = gitText(repo, ["status", "--porcelain", "--", "data"]);
  removeUntrackedBoardFiles(repo);
  restoreTrackedBoard(repo);

  const remote = remoteSha(repo, branch);
  if (remote) {
    const unpushed = gitText(repo, ["log", "--format=%s", `origin/${branch}..HEAD`]);
    const subjects = unpushed ? unpushed.split("\n").filter(Boolean) : [];
    if (subjects.length > 0) {
      if (subjects.some((subject) => subject !== BOARD_COMMIT_MESSAGE)) {
        throw new Error("Unpushed commits are not board commits. Refusing to move HEAD.");
      }
      const names = gitText(repo, ["diff", "--name-only", `origin/${branch}`, "HEAD"]);
      for (const name of names.split("\n").filter(Boolean)) {
        if (name === "data" || name.startsWith("data/")) {
          throw new Error("Unpushed board commits include data/. Refusing to move HEAD.");
        }
        const boardFile = BOARD_PATHS.some(
          (boardPath) => name === boardPath || name.startsWith(`${boardPath}/`)
        );
        if (!boardFile) {
          throw new Error(`Unpushed board commits include ${name}. Refusing to move HEAD.`);
        }
      }
      if (baseSha && !isAncestor(repo, baseSha, remote)) {
        throw new Error("Saved data commit is not on the remote. Refusing to move HEAD.");
      }
      // Move the branch back to the pushed tip. --keep keeps dirty data/.
      gitText(repo, ["reset", "--keep", remote]);
      restoreTrackedBoard(repo);
      removeUntrackedBoardFiles(repo);
    }
  }

  const dataAfter = gitText(repo, ["status", "--porcelain", "--", "data"]);
  if (dataBefore !== dataAfter) throw new Error("restore changed data/");
  if (baseSha && !isAncestor(repo, baseSha, "HEAD")) {
    throw new Error("Saved data commit is no longer in HEAD.");
  }
}

function main() {
  try {
    const branch = process.env.BRANCH || gitText(process.cwd(), ["rev-parse", "--abbrev-ref", "HEAD"]);
    restoreBoardAttempt(process.cwd(), { baseSha: process.env.BASE_SHA ?? "", branch });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) main();
