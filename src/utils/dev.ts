export function renderProgress(current: number, total: number) {
  const width = 30;
  const ratio = current / total;
  const filled = Math.round(width * ratio);
  const empty = width - filled;

  const bar = "█".repeat(filled) + "-".repeat(empty);
  const percent = (ratio * 100).toFixed(1);

  process.stdout.write(`\r[${bar}] ${current}/${total} (${percent}%)`);
}
