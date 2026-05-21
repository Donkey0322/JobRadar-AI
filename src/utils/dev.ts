export function renderProgress(current: number, total: number) {
  // Skip in CI / GitHub Actions
  if (!process.stdout.isTTY) {
    return;
  }

  const width = 30;
  const ratio = current / total;
  const filled = Math.round(width * ratio);
  const empty = width - filled;

  const bar = "█".repeat(filled) + "-".repeat(empty);
  const percent = (ratio * 100).toFixed(1);

  process.stdout.write(`\r[${bar}] ${current}/${total} (${percent}%)`);

  if (current === total) {
    process.stdout.write("\n");
  }
}
