import { execFileSync } from "node:child_process";

import type { Job } from "@/types";

const GIT_MAX_BUFFER = 50 * 1024 * 1024;

function parseDiffJob(line: string): Job {
  return JSON.parse(line.slice(1)) as Job;
}

export function getNewJobsFromDiff(from: string, to: string): Job[] {
  const diff = execFileSync("git", ["diff", "-U0", from, to, "--", "data/jobs.ndjson"], {
    encoding: "utf-8",
    maxBuffer: GIT_MAX_BUFFER,
  });

  const lines = diff.split("\n");
  const removedLinks = new Set(
    lines
      .filter((line) => line.startsWith("-") && !line.startsWith("---"))
      .map((line) => parseDiffJob(line).link)
  );

  return lines
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map(parseDiffJob)
    .filter((job) => !removedLinks.has(job.link));
}
