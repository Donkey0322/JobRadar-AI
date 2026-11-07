import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const WARNING = "::warning::Could not write the run summary. The task result is unchanged.\n";

/** Append one stage record. A missing directory or a write error does not change the task result. */
export function recordStage(record: object): void {
  const dir = process.env.JOBRADAR_SUMMARY_DIR;
  if (!dir) return;

  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, "stages.ndjson"), `${JSON.stringify(record)}\n`);
  } catch {
    process.stderr.write(WARNING);
  }
}
