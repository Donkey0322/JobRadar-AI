let progressStartedAt: number | null = null;
let lastCurrent = 0;
let lastTotal = 0;
/** Timing fields only refresh on the wall-clock tick, not on every progress update. */
let displayedElapsedMs = 0;
let displayedEtaMs = Number.NaN;
let tickTimer: ReturnType<typeof setInterval> | null = null;

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
  const timing =
    current < total
      ? ` ${formatDuration(displayedElapsedMs)} ETA ${formatDuration(displayedEtaMs)}`
      : ` ${formatDuration(displayedElapsedMs)}`;

  process.stdout.write(`\r[${bar}] ${current}/${total} (${percent}%)${timing}   `);
}

function onWallClockTick() {
  refreshDisplayedTiming();
  drawProgress();
}

function ensureTickTimer() {
  if (tickTimer || !process.stdout.isTTY) {
    return;
  }

  // Elapsed + ETA update once per real second together; bar can refresh sooner.
  tickTimer = setInterval(onWallClockTick, 1000);
}

/** Start (or restart) a progress run so the clock ticks before the first item finishes. */
export function startProgress(total: number) {
  if (!process.stdout.isTTY) {
    return;
  }

  clearTickTimer();
  progressStartedAt = Date.now();
  lastCurrent = 0;
  lastTotal = total;
  displayedElapsedMs = 0;
  displayedEtaMs = Number.NaN;
  drawProgress();
  ensureTickTimer();
}

export function renderProgress(current: number, total: number) {
  // Skip in CI / GitHub Actions
  if (!process.stdout.isTTY) {
    return;
  }

  if (progressStartedAt == null || current < lastCurrent) {
    progressStartedAt = Date.now();
    displayedElapsedMs = 0;
    displayedEtaMs = Number.NaN;
    clearTickTimer();
  }

  lastCurrent = current;
  lastTotal = total;

  // Progress bar/count update immediately; leave elapsed/ETA for the wall-clock tick.
  drawProgress();

  if (current >= total && total > 0) {
    refreshDisplayedTiming();
    drawProgress();
    process.stdout.write("\n");
    clearTickTimer();
    progressStartedAt = null;
    lastCurrent = 0;
    lastTotal = 0;
    displayedElapsedMs = 0;
    displayedEtaMs = Number.NaN;
    return;
  }

  ensureTickTimer();
}
