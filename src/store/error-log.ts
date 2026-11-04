import { promises as fs } from "node:fs";

import { ERROR_LOG_PATH } from "@/store/paths";
import { logger } from "@/utils/logger";

export async function appendErrorLog(message: string) {
  // CI runs have no local log file to read, so surface the line in the job output.
  if (!process.stdout.isTTY) {
    logger.warn(message);
    return;
  }
  const timestamp = new Date().toISOString();
  await fs.appendFile(ERROR_LOG_PATH, `${timestamp} ${message}\n`, "utf-8");
}

export const errorLog = {
  append: appendErrorLog,
};
