let progressStartedAt: number | null = null;
let lastCurrent = 0;
let lastTotal = 0;
/** Timing fields only refresh on the wall-clock tick, not on every progress update. */
let displayedElapsedMs = 0;
let displayedEtaMs = Number.NaN;
let tickTimer: ReturnType<typeof setInterval> | null = null;

/** GitHub Actions has no TTY, so a carriage-return bar never shows up in the log. */
const CI_PROGRESS_INTERVAL_MS = 30_000;

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "--";
  }

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h${minutes.toString().padStart(2, "0")}m${seconds.toString().padStart(2, "0")}s`;
  }
  if (minutes > 0) {
    return `${minutes}m${seconds.toString().padStart(2, "0")}s`;
  }
  return `${totalSeconds}s`;
}

function clearTickTimer() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

function refreshDisplayedTiming() {
  if (progressStartedAt == null) {
    displayedElapsedMs = 0;
    displayedEtaMs = Number.NaN;
    return;
  }

  displayedElapsedMs = Date.now() - progressStartedAt;

  if (lastCurrent > 0 && lastCurrent < lastTotal && displayedElapsedMs > 0) {
    displayedEtaMs = ((lastTotal - lastCurrent) * displayedElapsedMs) / lastCurrent;
  } else {
    displayedEtaMs = Number.NaN;
  }
}

function timingSuffix(current: number): string {
  const elapsed = formatDuration(displayedElapsedMs);
  if (current < lastTotal) {
    return `${elapsed} ETA ${formatDuration(displayedEtaMs)}`;
  }
  return elapsed;
}

function logCiProgress() {
  if (process.stdout.isTTY || progressStartedAt == null || lastTotal <= 0) {
    return;
  }

  refreshDisplayedTiming();

  const ratio = lastTotal > 0 ? lastCurrent / lastTotal : 0;
  const percent = (ratio * 100).toFixed(1);
  console.log(`progress ${lastCurrent}/${lastTotal} (${percent}%) ${timingSuffix(lastCurrent)}`);
}

function drawProgress() {
  if (!process.stdout.isTTY || progressStartedAt == null || lastTotal <= 0) {
    return;
  }

  const current = lastCurrent;
  const total = lastTotal;

  const width = 30;
  const ratio = total > 0 ? current / total : 0;
  const filled = Math.round(width * ratio);
  const empty = width - filled;

  const bar = "█".repeat(filled) + "-".repeat(empty);
  const percent = (ratio * 100).toFixed(1);
  const timing = ` ${timingSuffix(current)}`;

  process.stdout.write(`\r[${bar}] ${current}/${total} (${percent}%)${timing}   `);
}

function onWallClockTick() {
  refreshDisplayedTiming();
  drawProgress();
}

function resetProgress(total: number) {
  clearTickTimer();
  progressStartedAt = Date.now();
  lastCurrent = 0;
  lastTotal = total;
  displayedElapsedMs = 0;
  displayedEtaMs = Number.NaN;
}

function finishProgress() {
  clearTickTimer();
  progressStartedAt = null;
  lastCurrent = 0;
  lastTotal = 0;
  displayedElapsedMs = 0;
  displayedEtaMs = Number.NaN;
}

function ensureTickTimer() {
  if (tickTimer) {
    return;
  }

  if (!process.stdout.isTTY) {
    tickTimer = setInterval(() => {
      logCiProgress();
    }, CI_PROGRESS_INTERVAL_MS);
    tickTimer.unref();
    return;
  }

  // Elapsed + ETA update once per real second together; bar can refresh sooner.
  tickTimer = setInterval(onWallClockTick, 1000);
}

/** Start (or restart) a progress run so the clock ticks before the first item finishes. */
export function startProgress(total: number) {
  resetProgress(total);

  if (!process.stdout.isTTY) {
    logCiProgress();
    ensureTickTimer();
    return;
  }

  drawProgress();
  ensureTickTimer();
}

export function renderProgress(current: number, total: number) {
  if (progressStartedAt == null || current < lastCurrent) {
    progressStartedAt = Date.now();
    displayedElapsedMs = 0;
    displayedEtaMs = Number.NaN;
    clearTickTimer();
  }

  lastCurrent = current;
  lastTotal = total;

  if (!process.stdout.isTTY) {
    if (current >= total && total > 0) {
      logCiProgress();
      finishProgress();
    } else {
      ensureTickTimer();
    }
    return;
  }

  // Progress bar/count update immediately; leave elapsed/ETA for the wall-clock tick.
  drawProgress();

  if (current >= total && total > 0) {
    refreshDisplayedTiming();
    drawProgress();
    process.stdout.write("\n");
    finishProgress();
    return;
  }

  ensureTickTimer();
}
