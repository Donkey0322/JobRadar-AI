import fs from "node:fs/promises";

import type { Config, Country, JobCategory } from "@/validation/config";

type InternCategory = JobCategory.SUMMER_INTERN | JobCategory.OFF_SEASON_INTERN;
type FullTimeCategory = JobCategory.ENTRY_LEVEL | JobCategory.MID_LEVEL | JobCategory.SENIOR_LEVEL;

type AIProvider = "openai" | "google" | "anthropic";

const AI_ENABLED_LABEL = "Enable AI JD analysis";

function normalizeLine(line: string): string {
  return line.trim();
}

function getSection(body: string, title: string): string {
  const lines = body.split(/\r?\n/);
  const heading = `### ${title}`;

  let start = -1;

  for (let i = 0; i < lines.length; i++) {
    if (normalizeLine(lines[i]) === heading) {
      start = i + 1;
      break;
    }
  }

  if (start === -1) {
    return "";
  }

  const sectionLines: string[] = [];

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];

    if (normalizeLine(line).startsWith("### ")) {
      break;
    }

    sectionLines.push(line);
  }

  return sectionLines.join("\n").trim();
}

function getScalar(body: string, title: string): string {
  return (
    getSection(body, title)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function getRequired(body: string, title: string): string {
  const value = getScalar(body, title);

  if (!value) {
    throw new Error(`Missing required field: ${title}`);
  }

  return value;
}

function parseCheckboxes(body: string, title: string): string[] {
  return getSection(body, title)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^-\s*\[[xX]\]\s+/.test(line))
    .map((line) => line.replace(/^-\s*\[[xX]\]\s+/, "").trim())
    .filter(Boolean);
}

function parseCheckboxEnabled(body: string, title: string, checkedLabel: string): boolean {
  return parseCheckboxes(body, title).includes(checkedLabel);
}

function parseLines(body: string, title: string): string[] {
  return getSection(body, title)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseBoolean(body: string, title: string): boolean {
  const value = getRequired(body, title).toLowerCase();

  if (value === "true") return true;
  if (value === "false") return false;

  throw new Error(`Invalid boolean value for ${title}: ${value}`);
}

function parseNumber(body: string, title: string): number {
  const raw = getRequired(body, title);
  const value = Number(raw);

  if (!Number.isFinite(value)) {
    throw new Error(`Invalid number value for ${title}: ${raw}`);
  }

  return value;
}

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
  const intern = parseCheckboxes(issueBody, "Internship targets").map(
    (category) => category as InternCategory
  );

  const fullTime = parseCheckboxes(issueBody, "Full-time targets").map(
    (category) => category as FullTimeCategory
  );

  const countries = parseCheckboxes(issueBody, "Countries").map((country) => country as Country);

  if (intern.length === 0 && fullTime.length === 0) {
    throw new Error("Please select at least one internship or full-time target.");
  }

  if (countries.length === 0) {
    throw new Error("Please select at least one country.");
  }

  const allowCitizenshipRequired = parseBoolean(issueBody, "Allow citizenship-required jobs?");

  const allowNoSponsorship = parseBoolean(issueBody, "Allow jobs without sponsorship?");

  const senderEmail = getRequired(issueBody, "Sender email");
  const senderUser = getRequired(issueBody, "SMTP user");

  return {
    target: {
      ...(intern.length > 0 ? { intern } : {}),
      ...(fullTime.length > 0 ? { "full-time": fullTime } : {}),
      countries,
      filter: buildCountryFilter(countries, allowCitizenshipRequired, allowNoSponsorship),
      keywords: parseLines(issueBody, "Keywords"),
    },
    ai: {
      enabled: parseCheckboxEnabled(issueBody, "AI enabled", AI_ENABLED_LABEL),
      provider: getRequired(issueBody, "AI provider") as AIProvider,
      model: getRequired(issueBody, "AI model"),
    },
    sender: {
      host: getRequired(issueBody, "SMTP host"),
      port: parseNumber(issueBody, "SMTP port"),
      user: senderUser,
      email: senderEmail,
    },
    receiver: {
      email: getRequired(issueBody, "Receiver email"),
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
