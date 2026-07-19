import fs from "node:fs/promises";

import type { Config, Country, JobCategory } from "@/validation/config";

import { createIssueSectionParser } from "../../utils/github-issue";

type InternCategory = JobCategory.SUMMER_INTERN | JobCategory.OFF_SEASON_INTERN;
type FullTimeCategory = JobCategory.ENTRY_LEVEL | JobCategory.MID_LEVEL | JobCategory.SENIOR_LEVEL;

type AIProvider = "openai" | "google" | "anthropic";

const AI_ENABLED_LABEL = "Enable AI JD analysis";

function buildCountryFilter(
  countries: Country[],
  allowCitizenshipRequired: boolean,
  allowNoSponsorship: boolean
): Config["target"]["filter"] {
  return Object.fromEntries(
    countries.map((country) => [
      country,
      {
        allow_citizenship_required: allowCitizenshipRequired,
        allow_no_sponsorship: allowNoSponsorship,
      },
    ])
  ) as Config["target"]["filter"];
}

function buildConfig(issueBody: string): Config {
  const issue = createIssueSectionParser(issueBody);
  const intern = issue
    .checkboxes("Internship targets")
    .map((category) => category as InternCategory);

  const fullTime = issue
    .checkboxes("Full-time targets")
    .map((category) => category as FullTimeCategory);

  const countries = issue.checkboxes("Countries").map((country) => country as Country);

  if (intern.length === 0 && fullTime.length === 0) {
    throw new Error("Please select at least one internship or full-time target.");
  }

  if (countries.length === 0) {
    throw new Error("Please select at least one country.");
  }

  const allowCitizenshipRequired = issue.boolean("Allow citizenship-required jobs?");

  const allowNoSponsorship = issue.boolean("Allow jobs without sponsorship?");

  const senderEmail = issue.required("Sender email");
  const senderUser = issue.required("SMTP user");

  return {
    target: {
      ...(intern.length > 0 ? { intern } : {}),
      ...(fullTime.length > 0 ? { "full-time": fullTime } : {}),
      countries,
      filter: buildCountryFilter(countries, allowCitizenshipRequired, allowNoSponsorship),
      keywords: issue.lines("Keywords"),
    },
    ai: {
      enabled: issue.checkboxEnabled("AI enabled", AI_ENABLED_LABEL),
      provider: issue.required("AI provider") as AIProvider,
      model: issue.required("AI model"),
    },
    sender: {
      host: issue.required("SMTP host"),
      port: issue.number("SMTP port"),
      user: senderUser,
      email: senderEmail,
    },
    receiver: {
      email: issue.required("Receiver email"),
    },
  };
}

export default async function getConfig(): Promise<void> {
  const issueBody = process.env.ISSUE_BODY;

  if (!issueBody) {
    throw new Error("ISSUE_BODY is not set");
  }

  const config = buildConfig(issueBody);

  await fs.writeFile("config.json", `${JSON.stringify(config, null, 2)}\n`);
}
