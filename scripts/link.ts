import { promises as fs } from "fs";
import inquirer from "inquirer";

import type { Job } from "@/types";

import processor from "@/main";
import { analyzeLink } from "@/modules/jd-analyzer";
import { logger } from "@/utils/logger";

export async function promptJob(): Promise<Job> {
  const answers: Job = await inquirer.prompt([
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
    { name: "location", message: "Location:", type: "input" },
    {
      name: "season",
      message: "Season (optional):",
      type: "list",
      choices: ["2026 Summer", "2026 Fall", "2027 Spring", "New Grad", "Skip"],
      filter: (val) => (val === "Skip" ? undefined : val),
    },
  ]);
  return answers;
}
async function main() {
  const args = process.argv.slice(2);

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
    logger.error("❌ Cannot use -l and -f together");
    process.exit(1);
  }

  // --- modes ---

  // 1. link mode
  if (link) {
    try {
      new URL(link);
    } catch {
      logger.error("❌ Invalid URL");
      process.exit(1);
    }

    const jd = await analyzeLink(link);

    if (!jd) {
      logger.info("❌ No result");
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

    await processor([job], false, true);
    return;
  }

  // 3. default → add mode
  const job = await promptJob();
  await processor([job], false, true);
}

main().catch((err) => {
  logger.fatal({ err }, "❌ Error");
  process.exit(1);
});
