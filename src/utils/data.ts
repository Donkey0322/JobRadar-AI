import { promises as fs } from "fs";
import { SENT_PATH } from "@/constants";

export async function loadSent(): Promise<Set<string>> {
  try {
    const content = await fs.readFile(SENT_PATH, "utf-8");
    const parsed: string[] = JSON.parse(content);
    return new Set(parsed);
  } catch {
    return new Set();
  }
}

export async function saveSent(sentSet: Set<string>) {
  const sorted = Array.from(sentSet).sort();
  const json = JSON.stringify(sorted, null, 2);
  await fs.writeFile(SENT_PATH, json, "utf-8");
}
