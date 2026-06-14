import { promises as fs } from "fs";
import inquirer from "inquirer";

import { RED_CROSS } from "@/constants/log";

import type { Job } from "@/types";

import { createSyncContext, processJobs } from "./command/sync/shared";

import { analyzeLink } from "@/modules/jd-analyzer";
import { logger } from "@/utils/logger";

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
    const job: Job = JSON.parse(content);

    await processJobs({ jobs: [job], ...context });
    return;
  }

  // 3. default → add mode
  const job = await promptJob();
  await processJobs({ jobs: [job], ...context });
}

main().catch((err) => {
  logger.fatal({ err }, `${RED_CROSS} Error`);
  process.exit(1);
});
