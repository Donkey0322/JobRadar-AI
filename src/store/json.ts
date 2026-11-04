import { promises as fs } from "node:fs";

/**
 * Read and parse a JSON file. File-system and parse errors are propagated.
 */
export async function readJsonFile<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, "utf-8");
  return JSON.parse(content) as T;
}
