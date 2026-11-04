import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { DATA_PATH, URLS_PATH } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import { classifyATS } from "@/modules/employer/classifier";
import { readJsonFile } from "@/utils/data";
import { getJobKey } from "@/utils/job-key";
import { logger } from "@/utils/logger";

/**
 * Write every URL in data/urls.json with its ATS and job key, sorted by URL, as TSV.
 * Read-only: run it on the same input before and after a change, then diff the files.
 *
 * tsx scripts/check/job-keys.ts [--input data/urls.json] [--out <tmpdir>/jobradar-job-keys.tsv]
 */

const DEFAULT_OUT = path.join(os.tmpdir(), "jobradar-job-keys.tsv");

function parseArgs(args: string[]) {
  let input = URLS_PATH;
  let out = DEFAULT_OUT;

  for (let i = 0; i < args.length; i++) {
    const value = args[i + 1];

    if (args[i] === "--input" && value) {
      input = path.resolve(value);
      i++;
    } else if (args[i] === "--out" && value) {
      out = path.resolve(value);
      i++;
    } else {
      throw new Error(`Unknown argument: ${args[i]}`);
    }
  }

  return { input, out };
}

function isInside(dir: string, file: string) {
  const relative = path.relative(dir, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function classify(url: string) {
  try {
    return classifyATS(new URL(url));
  } catch {
    return "invalid";
  }
}

async function main() {
  const { input, out } = parseArgs(process.argv.slice(2));

  if (isInside(DATA_PATH, out)) {
    throw new Error(`Refusing to write inside ${DATA_PATH}: ${out}`);
  }

  const urls = [...new Set(await readJsonFile<string[]>(input))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  const urlsByKey = new Map<string, string[]>();
  const rows = ["url\tats\tkey"];

  for (const url of urls) {
    const key = getJobKey(url);
    rows.push(`${url}\t${classify(url)}\t${key}`);
    urlsByKey.set(key, [...(urlsByKey.get(key) ?? []), url]);
  }

  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, `${rows.join("\n")}\n`, "utf-8");

  const sharedKeys = [...urlsByKey].filter(([, group]) => group.length > 1);

  logger.info(
    {
      input,
      out,
      urls: urls.length,
      keys: urlsByKey.size,
      sharedKeys: sharedKeys.length,
      urlsInSharedKeys: sharedKeys.reduce((sum, [, group]) => sum + group.length, 0),
      examples: Object.fromEntries(sharedKeys.slice(0, 5)),
    },
    "🔑 Wrote URL → job key baseline"
  );
}

main().catch((err) => {
  logger.fatal({ err }, `${RED_CROSS} Job key baseline failed`);
  process.exit(1);
});
