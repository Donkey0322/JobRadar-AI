import inquirer from "inquirer";
import { promises as fs } from "node:fs";

import { RED_CROSS } from "@/constants/log";

import type { Job } from "@/types";

import { createSyncContext, processJobs } from "./ingest";

import { companyKey } from "@/modules/employer/build";
import { knownEmployerName } from "@/modules/employer/remap";
import { analyzeLink } from "@/modules/posting";
import * as store from "@/store";
import { logger } from "@/utils/logger";
import { isValidHttpUrl } from "@/utils/url";

const REQUIRED_LINK_FIELDS = ["company", "role", "location"] as const;

function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

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

    if (!isValidHttpUrl(item.link)) {
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
      validate: (input) => (isValidHttpUrl(input) ? true : "Invalid URL"),
    },
  ]);
  return job;
}

async function readJobFile(file: string): Promise<Job[]> {
  let content: string;

  try {
    content = await fs.readFile(file, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cannot read job file";
    logger.error(`${RED_CROSS} ${message}`);
    process.exit(1);
  }

  try {
    return parseJobs(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid job file";
    logger.error(`${RED_CROSS} ${message}`);
    process.exit(1);
  }
}

/**
 * A posting URL reliably supplies the link. The company name is reliable only
 * when it already belongs to a stored company. Role and location are not on
 * the URL, so they are never guessed.
 */
async function jobsFromLinks(links: string[]): Promise<Job[]> {
  const invalid = links.filter((link) => !isValidHttpUrl(link));

  if (invalid.length > 0) {
    for (const link of invalid) {
      logger.error(`${RED_CROSS} Invalid URL: ${link}`);
    }
    process.exit(1);
  }

  const companies = await store.companies.load();
  const companiesByKey = new Map(companies.map((company) => [companyKey(company), company]));
  const pending = links.map((link) => {
    const company = knownEmployerName(link, companiesByKey);
    const missing = REQUIRED_LINK_FIELDS.filter((field) => field !== "company" || !company);
    return { link, company, missing };
  });
  const incomplete = pending.filter((item) => item.missing.length > 0);

  if (incomplete.length > 0 && !isInteractive()) {
    for (const item of incomplete) {
      logger.error(`${RED_CROSS} Missing ${item.missing.join(", ")} for ${item.link}`);
    }
    process.exit(1);
  }

  const jobs: Job[] = [];

  for (const item of pending) {
    const answers = await inquirer.prompt<Partial<Pick<Job, "company" | "role" | "location">>>(
      item.missing.map((field) => ({
        name: field,
        message: `${field[0]?.toUpperCase()}${field.slice(1)} for ${item.link}:`,
        type: "input" as const,
        validate: (input: string) => (input ? true : `${field} is required`),
      }))
    );
    const company = item.company ?? answers.company;
    const role = answers.role;
    const location = answers.location;

    if (!company || !role || !location) {
      logger.error(`${RED_CROSS} Missing company, role, location for ${item.link}`);
      process.exit(1);
    }

    jobs.push({ company, role, location, link: item.link });
  }

  return jobs;
}

export async function addJob(options: { links?: string[]; file?: string } = {}) {
  const links = options.links ?? [];
  const file = options.file;

  if (links.length > 0 && file !== undefined) {
    logger.error(`${RED_CROSS} Cannot use --link and --file together`);
    process.exit(1);
  }

  let jobs: Job[];

  if (file !== undefined) {
    jobs = await readJobFile(file);
  } else if (links.length > 0) {
    jobs = await jobsFromLinks(links);
  } else if (!isInteractive()) {
    logger.error(`${RED_CROSS} Missing company, role, location, link`);
    process.exit(1);
  } else {
    jobs = [await promptJob()];
  }

  const context = await createSyncContext();
  const result = await processJobs({ jobs, ...context });

  logger.info(
    { added: result.count, skipped: result.skipped, failed: result.failed },
    "Job add finished"
  );

  if (result.count === 0 && result.skipped === 0 && result.batched === 0 && result.failed > 0) {
    process.exit(1);
  }
}

export async function analyzeJobs(links: string[]) {
  if (links.length === 0) {
    logger.error(`${RED_CROSS} Link is required`);
    process.exit(1);
  }

  const invalid = links.filter((link) => !isValidHttpUrl(link));

  if (invalid.length > 0) {
    for (const link of invalid) {
      logger.error(`${RED_CROSS} Invalid URL: ${link}`);
    }
    process.exit(1);
  }

  for (const link of links) {
    const jd = await analyzeLink(link);

    if (!jd) {
      logger.info({ url: link }, `${RED_CROSS} No result`);
      continue;
    }

    logger.info({ url: link }, "\n ✏️ Result:\n%s", JSON.stringify(jd, null, 2));
  }
}
