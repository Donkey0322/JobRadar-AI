import { promises as fs } from "fs";
import inquirer from "inquirer";

import { RED_CROSS } from "@/constants/log";

import type { Job } from "@/types";

import { createSyncContext, processJobs } from "./command/sync/shared";

import { HttpStatusCode } from "@/modules/ats/detail";
import { analyzeLink, getRawJD } from "@/modules/job-analysis";
import { logger } from "@/utils/logger";

function isJob(value: unknown): value is Job {
  if (!value || typeof value !== "object") return false;

  const job = value as Record<string, unknown>;
  return (
    typeof job.company === "string" &&
    job.company.length > 0 &&
    typeof job.role === "string" &&
    job.role.length > 0 &&
    typeof job.location === "string" &&
    job.location.length > 0 &&
    typeof job.link === "string"
  );
}

function parseJobs(content: string): Job[] {
  const parsed: unknown = JSON.parse(content);
  const items = Array.isArray(parsed) ? parsed : [parsed];

  if (items.length === 0) {
    throw new Error("Job file is empty");
  }

  return items.map((item, index) => {
    if (!isJob(item)) {
      throw new Error(`Invalid job at index ${index}`);
    }

    try {
      new URL(item.link);
    } catch {
      throw new Error(`Invalid URL at index ${index}`);
    }

    return item;
  });
}

export async function promptJob(): Promise<Job> {
  const job = await inquirer.prompt<Job>([
    {
      name: "company",
      message: "Company:",
      type: "input",
      validate: (input) => (input ? true : "Company is required"),
    },
    {
      name: "role",
      message: "Role:",
      type: "input",
      validate: (input) => (input ? true : "Role is required"),
    },
    {
      name: "location",
      message: "Location:",
      type: "input",
      validate: (input) => (input ? true : "Location is required"),
    },
    {
      name: "link",
      message: "Link:",
      type: "input",
      validate: (input) => {
        try {
          new URL(input);
          return true;
        } catch {
          return "Invalid URL";
        }
      },
    },
  ]);
  return job;
}

async function main() {
  const args = process.argv.slice(2);
  const context = await createSyncContext();

  let link: string | undefined;
  let file: string | undefined;

  // parse args
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "-l") {
      link = args[i + 1];
      i++;
    } else if (arg === "-f") {
      const next = args[i + 1];
      if (!next || next.startsWith("-")) {
        file = "scripts/job.json";
      } else {
        file = next;
        i++;
      }
    }
  }

  // ❗Cannot use -l and -f together
  if (link && file) {
    logger.error(`${RED_CROSS} Cannot use -l and -f together`);
    process.exit(1);
  }

  // --- modes ---

  // 1. link mode
  if (link) {
    try {
      new URL(link);
    } catch {
      logger.error(`${RED_CROSS} Invalid URL`);
      process.exit(1);
    }

    const jd = await analyzeLink(link);

    if (!jd) {
      logger.info(`${RED_CROSS} No result`);
      return;
    }

    logger.info("\n ✏️ Result:\n%s", JSON.stringify(jd, null, 2));
    return;
  }

  // 2. file mode
  if (file !== undefined) {
    const filePath = file ?? "scripts/job.json";
    const content = await fs.readFile(filePath, "utf8");

    let jobs: Job[];
    try {
      jobs = parseJobs(content);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid job file";
      logger.error(`${RED_CROSS} ${message}`);
      process.exit(1);
    }

    const ready: Job[] = [];
    for (const job of jobs) {
      const { error } = await getRawJD(job.link);
      if (HttpStatusCode.isError(error.code)) {
        logger.error(`${RED_CROSS} ${job.company} — ${job.role}`);
        continue;
      }
      ready.push(job);
    }

    if (ready.length === 0) {
      process.exit(1);
    }

    await processJobs({ jobs: ready, ...context });
    return;
  }

  // 3. default → add mode
  const job = await promptJob();
  const { error } = await getRawJD(job.link);
  if (HttpStatusCode.isError(error.code)) {
    process.exit(1);
  }
  await processJobs({ jobs: [job], ...context });
}

main().catch((err) => {
  logger.fatal({ err }, `${RED_CROSS} Error`);
  process.exit(1);
});
