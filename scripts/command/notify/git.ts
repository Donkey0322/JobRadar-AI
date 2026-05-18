import { execSync } from "node:child_process";

import type { Job } from "@/types";

export function getNewJobsFromDiff(from: string, to: string): Job[] {
  const diff = execSync(`git diff ${from} ${to} -- data/jobs.ndjson`, {
    encoding: "utf-8",
  });

  return diff
    .split("\n")
    .filter((line) => line.startsWith("+"))
    .filter((line) => !line.startsWith("+++"))
    .map((line) => JSON.parse(line.slice(1)) as Job);
}
