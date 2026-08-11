let progressStartedAt: number | null = null;
let lastCurrent = 0;

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
  return `${(ms / 1000).toFixed(1)}s`;
}

export function renderProgress(current: number, total: number) {
  // Skip in CI / GitHub Actions
  if (!process.stdout.isTTY) {
    return;
  }

  if (current <= 1 || current < lastCurrent) {
    progressStartedAt = Date.now();
  }
  lastCurrent = current;

  const startedAt = progressStartedAt ?? Date.now();
  progressStartedAt = startedAt;

  const elapsed = Date.now() - startedAt;
  const eta =
    current > 0 && elapsed > 0 ? ((total - current) * elapsed) / current : Number.NaN;

  const width = 30;
  const ratio = total > 0 ? current / total : 0;
  const filled = Math.round(width * ratio);
  const empty = width - filled;

  const bar = "█".repeat(filled) + "-".repeat(empty);
  const percent = (ratio * 100).toFixed(1);
  const timing =
    current < total
      ? ` ${formatDuration(elapsed)} ETA ${formatDuration(eta)}`
      : ` ${formatDuration(elapsed)}`;

  process.stdout.write(`\r[${bar}] ${current}/${total} (${percent}%)${timing}`);

  if (current === total) {
    process.stdout.write("\n");
    progressStartedAt = null;
    lastCurrent = 0;
  }
}
