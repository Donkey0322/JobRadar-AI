/**
 * Run a command in its own process group and stop it when the deadline passes.
 * The direct child exiting does not mean the group is gone: a descendant can
 * ignore SIGTERM and keep running. After a timeout or an external signal, the
 * SIGKILL grace timer stays armed until the group has ended.
 * Exit 124 when the deadline stops the command. An external SIGTERM or SIGINT
 * keeps that signal's exit status. A command that finishes on its own keeps
 * its status and does not wait for the grace period.
 */

import { spawn } from "node:child_process";
import process from "node:process";
import { clearInterval, clearTimeout, setInterval, setTimeout } from "node:timers";

const seconds = Number(process.argv[2]);
const command = process.argv.slice(3);
if (!Number.isInteger(seconds) || seconds <= 0 || command.length === 0) {
  process.stderr.write("usage: run-deadline.mjs SECONDS command...\n");
  process.exit(2);
}

const rawKillAfter = process.env.JOBRADAR_KILL_AFTER_MS;
const killAfter = rawKillAfter === undefined ? 20000 : Number(rawKillAfter);
if (!Number.isFinite(killAfter) || killAfter < 0) {
  process.stderr.write("JOBRADAR_KILL_AFTER_MS must be a non-negative number\n");
  process.exit(2);
}

const POLL_MS = 20;
const SETTLE_MS = 500;

let stopReason = "";
let finished = false;
let deadlineTimer;
let killTimer;
let pollTimer;

function groupAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return !(error && error.code === "ESRCH");
  }
}

function signalGroup(pid, signal) {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch {
    // The process group has already exited.
  }
}

function signalNumber(signal) {
  if (signal === "SIGTERM") return 15;
  if (signal === "SIGINT") return 2;
  if (signal === "SIGKILL") return 9;
  return 1;
}

function stopExitCode() {
  if (stopReason === "timeout") return 124;
  if (stopReason === "SIGTERM" || stopReason === "SIGINT") return 128 + signalNumber(stopReason);
  return 1;
}

function finish(code) {
  if (finished) return;
  finished = true;
  clearTimeout(deadlineTimer);
  clearTimeout(killTimer);
  clearInterval(pollTimer);
  process.exit(code);
}

function watchGroup(pid) {
  if (pollTimer || finished) return;
  const started = Date.now();
  const limit = killAfter + SETTLE_MS;
  pollTimer = setInterval(() => {
    if (!groupAlive(pid) || Date.now() - started >= limit) finish(stopExitCode());
  }, POLL_MS);
}

function beginStop(reason) {
  if (finished || stopReason) return;
  stopReason = reason;
  clearTimeout(deadlineTimer);
  if (reason === "timeout") {
    process.stderr.write(`Step exceeded ${seconds}s and was stopped.\n`);
  }
  const pid = child.pid;
  signalGroup(pid, reason === "SIGINT" ? "SIGINT" : "SIGTERM");
  if (!groupAlive(pid)) {
    finish(stopExitCode());
    return;
  }
  if (!killTimer) {
    killTimer = setTimeout(() => signalGroup(pid, "SIGKILL"), killAfter);
  }
  watchGroup(pid);
}

const child = spawn(command[0], command.slice(1), {
  detached: true,
  stdio: "inherit",
});

deadlineTimer = setTimeout(() => beginStop("timeout"), seconds * 1000);

process.on("SIGTERM", () => beginStop("SIGTERM"));
process.on("SIGINT", () => beginStop("SIGINT"));

child.on("error", (error) => {
  process.stderr.write(`${error.message}\n`);
  finish(127);
});

child.on("exit", (code, signal) => {
  if (!stopReason) {
    if (signal) finish(128 + signalNumber(signal));
    else finish(code ?? 1);
    return;
  }
  // The parent can exit on the first signal while a descendant that ignores
  // it is still in the group. Completing here would cancel SIGKILL.
  if (!groupAlive(child.pid)) finish(stopExitCode());
});
