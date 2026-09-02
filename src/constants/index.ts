import path from "path";

import "dotenv/config";

import type Source from "@/types/source";
import type { Country } from "@/validation/config";

import config from "../../config.json";

import { type Config, ConfigSchema, JobCategory } from "@/validation/config";

const parsedConfig = ConfigSchema.parse(config);

export const DATA_PATH = path.join(process.cwd(), "data");
export const URLS_PATH = path.join(DATA_PATH, "urls.json");
export const JOB_PATH = path.join(DATA_PATH, "jobs.ndjson");
export const OPPORTUNITIES_PATH = path.join(DATA_PATH, "opportunities.ndjson");
export const ARCHIVE_PATH = path.join(DATA_PATH, "archive");
export const JOB_ARCHIVE_CHUNK = 1000;
export const OPPORTUNITY_ARCHIVE_CHUNK = 5000;
export const JD_PATH = path.join(DATA_PATH, "jd");
export const COMPANY_PATH = path.join(DATA_PATH, "company.json");
export const ERROR_LOG_PATH = path.join(DATA_PATH, "discover-errors.log");
export const BATCH_PATH = path.join(DATA_PATH, "batch");
export const BATCH_QUEUE_PATH = path.join(BATCH_PATH, "queue.ndjson");
export const BATCH_INFLIGHT_PATH = path.join(BATCH_PATH, "inflight.json");

export { default as SEASONS } from "./season";
export { default as COUNTRIES } from "./country";

export const CONFIG: Config & { sender: { pass: string } } = {
  target: parsedConfig.target,
  dashboard: parsedConfig.dashboard,
  ai: parsedConfig.ai,
  sender: {
    host: parsedConfig.sender.host,
    port: Number(parsedConfig.sender.port),
    user: parsedConfig.sender.user,
    pass: process.env.SMTP_PASS ?? "",
    email: parsedConfig.sender.email,
  },
  receiver: parsedConfig.receiver,
};

export const ALLOWED_COUNTRIES =
  CONFIG.target.countries.length > 0
    ? new Set<Country>([...CONFIG.target.countries, "Unsure"])
    : new Set<Country>([]);

export const JOB_CATEGORIES = [
  JobCategory.SUMMER_INTERN,
  JobCategory.OFF_SEASON_INTERN,
  JobCategory.ENTRY_LEVEL,
  JobCategory.MID_LEVEL,
  JobCategory.SENIOR_LEVEL,
] as const;

export const SOURCES: Source[] = [
  {
    name: "vansh",
    url: "https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/dev/README.md",
    format: "markdown",
    type: JobCategory.SUMMER_INTERN,
    disabled: false,
  },
  {
    name: "vansh-off-season",
    url: "https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/refs/heads/dev/OFFSEASON_README.md",
    format: "markdown",
    type: JobCategory.OFF_SEASON_INTERN,
    disabled: false,
  },
  {
    name: "vansh-new-grad",
    url: "https://raw.githubusercontent.com/vanshb03/New-Grad-2027/refs/heads/dev/README.md",
    format: "markdown",
    type: JobCategory.ENTRY_LEVEL,
    disabled: false,
  },
  {
    name: "simplify",
    url: "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/README.md",
    format: "html",
    type: JobCategory.SUMMER_INTERN,
    disabled: false,
  },
  {
    name: "simplify-off-season",
    url: "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/refs/heads/dev/README-Off-Season.md",
    format: "html",
    type: JobCategory.OFF_SEASON_INTERN,
    disabled: false,
  },
  {
    name: "simplify-new-grad",
    url: "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/refs/heads/dev/README.md",
    format: "html",
    type: JobCategory.ENTRY_LEVEL,
    disabled: false,
  },
];

export const ABORT_SIGNAL = AbortSignal.timeout(5 * 60 * 1000);
