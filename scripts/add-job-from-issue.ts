import fs from "node:fs/promises";

import { createSyncContext, processJobs } from "./command/sync/shared";

import { logger } from "@/utils/logger";

type SubmittedJob = {
  company: string;
  role: string;
  link: string;
  location: string;
};

type GitHubIssueEvent = {
  issue: {
    number: number;
    title: string;
    body: string | null;
    user?: {
      login?: string;
    };
    html_url?: string;
  };
  repository?: {
    full_name?: string;
  };
};

async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;

  if (!eventPath) {
    throw new Error("GITHUB_EVENT_PATH is missing.");
  }

  const event = await readJson<GitHubIssueEvent>(eventPath);
  const body = event.issue.body ?? "";

  const job: SubmittedJob = {
    company: getRequiredIssueField(body, "Company"),
    role: getRequiredIssueField(body, "Role"),
    link: getRequiredIssueField(body, "Link"),
    location: getRequiredIssueField(body, "Location"),
  };

  validateSubmittedJob(job);

  const context = await createSyncContext();

  await processJobs({
    jobs: [job],
    ...context,
  });

  logger.info("Processed submitted job:");
  logger.info(JSON.stringify(job, null, 2));
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

function getRequiredIssueField(body: string, label: string): string {
  const value = getIssueField(body, label);

  if (!value) {
    throw new Error(`Missing required issue field: ${label}`);
  }

  return value;
}

function getIssueField(body: string, label: string): string | null {
  const escapedLabel = escapeRegExp(label);

  const pattern = new RegExp(
    String.raw`###\s+${escapedLabel}\s*\n+([\s\S]*?)(?=\n+###\s+|\s*$)`,
    "i"
  );

  const match = body.match(pattern);
  const value = match?.[1]?.replace(/<!--[\s\S]*?-->/g, "").trim();

  if (!value || value === "_No response_") {
    return null;
  }

  return value;
}

function validateSubmittedJob(job: SubmittedJob): void {
  if (!isValidUrl(job.link)) {
    throw new Error(`Invalid job link: ${job.link}`);
  }

  for (const [key, value] of Object.entries(job)) {
    if (!value.trim()) {
      throw new Error(`Invalid empty field: ${key}`);
    }
  }
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main().catch((error) => {
  logger.error(error);
  process.exit(1);
});
