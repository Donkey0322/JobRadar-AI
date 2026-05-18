import path from "path";

import "dotenv/config";

import type Source from "@/types/source";

import config from "../../config.json";

import { type Config, ConfigSchema, Target } from "@/validation/config";

const parsedConfig = ConfigSchema.parse(config);

export const DATA_PATH = path.join(process.cwd(), "data");
export const URLS_PATH = path.join(DATA_PATH, "urls.json");
export const JOB_PATH = path.join(DATA_PATH, "jobs.ndjson");
export const JD_PATH = path.join(DATA_PATH, "jd");
export const COMPANY_PATH = path.join(DATA_PATH, "company.json");

export const LOCATIONS = ["USA", "Canada", "UK", "Other"] as const;
export type Location = (typeof LOCATIONS)[number];

// year should be dynamically change at the end of May
const NOW = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
export const YEAR = NOW.getMonth() >= 5 ? NOW.getFullYear() + 1 : NOW.getFullYear();

export const SEASONS = [
  `${YEAR} Summer`,
  `${YEAR} Fall`,
  `${YEAR} Spring`,
  `${YEAR} Winter`,
  "Entry Level",
  "Mid Level",
  "Senior Level",
  "unsure",
] as const;

export const CONFIG: Config & { sender: { pass: string } } = {
  target: parsedConfig.target,
  sender: {
    host: parsedConfig.sender.host,
    port: Number(parsedConfig.sender.port),
    user: parsedConfig.sender.user,
    pass: process.env.SMTP_PASS ?? "",
    email: parsedConfig.sender.email,
  },
  receiver: parsedConfig.receiver,
};

export const SOURCES: Source[] = [
  {
    name: "vansh",
    url: "https://raw.githubusercontent.com/vanshb03/Summer2026-Internships/dev/README.md",
    format: "markdown",
    type: Target.SUMMER_INTERN,
    disabled: !CONFIG.target?.intern?.includes(Target.SUMMER_INTERN),
  },
  {
    name: "vansh-off-season",
    url: "https://raw.githubusercontent.com/vanshb03/Summer2026-Internships/refs/heads/dev/OFFSEASON_README.md",
    format: "markdown",
    type: Target.OFF_SEASON_INTERN,
    disabled: !CONFIG.target?.intern?.includes(Target.OFF_SEASON_INTERN),
  },
  {
    name: "simplify",
    url: "https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/README.md",
    format: "html",
    type: Target.SUMMER_INTERN,
    disabled: !CONFIG.target?.intern?.includes(Target.SUMMER_INTERN),
  },
  {
    name: "simplify-off-season",
    url: "https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/refs/heads/dev/README-Off-Season.md",
    format: "html",
    type: Target.OFF_SEASON_INTERN,
    disabled: !CONFIG.target?.intern?.includes(Target.OFF_SEASON_INTERN),
  },
  {
    name: "simplify-new-grad",
    url: "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/refs/heads/dev/README.md",
    format: "html",
    type: Target.ENTRY_LEVEL,
    disabled: !CONFIG.target?.["full-time"]?.includes(Target.ENTRY_LEVEL),
  },
];
