import { createSyncContext, processJobs } from "./command/sync/shared";
import { createIssueSectionParser } from "./utils/github-issue";

import { readJsonFile } from "@/utils/data";
import { logger } from "@/utils/logger";
import { isValidHttpUrl } from "@/utils/url";

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

  const event = await readJsonFile<GitHubIssueEvent>(eventPath);
  const body = event.issue.body ?? "";
  const issue = createIssueSectionParser(body, { caseSensitive: false });
  const required = (label: string) =>
    issue.required(label, (title) => `Missing required issue field: ${title}`);

  const job: SubmittedJob = {
    company: required("Company"),
    role: required("Role"),
    link: required("Link"),
    location: required("Location"),
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

function validateSubmittedJob(job: SubmittedJob): void {
  if (!isValidHttpUrl(job.link)) {
    throw new Error(`Invalid job link: ${job.link}`);
  }

  for (const [key, value] of Object.entries(job)) {
    if (!value.trim()) {
      throw new Error(`Invalid empty field: ${key}`);
    }
  }
}

main().catch((error) => {
  logger.error(error);
  process.exit(1);
});
