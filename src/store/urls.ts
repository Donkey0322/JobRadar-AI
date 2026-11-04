import { promises as fs } from "node:fs";

import { RED_CROSS } from "@/constants/log";

import { readJsonFile } from "@/store/json";
import { URLS_PATH } from "@/store/paths";
import { logger } from "@/utils/logger";

export async function loadUrls(): Promise<Set<string>> {
  try {
    const parsed = await readJsonFile<string[]>(URLS_PATH);
    return new Set(parsed);
  } catch {
    return new Set();
  }
}

/**
 * Rewrite urls to the urls file.
 * @param urlsSet - The urls to save.
 */
export async function saveUrls(urlsSet: Set<string>) {
  const sorted = Array.from(urlsSet).sort();
  const json = JSON.stringify(sorted, null, 2);
  try {
    await fs.writeFile(URLS_PATH, json, "utf-8");
  } catch (error) {
    logger.error({ err: error }, `${RED_CROSS} Error saving urls`);
  }
}

export const urls = {
  load: loadUrls,
  save: saveUrls,
};
