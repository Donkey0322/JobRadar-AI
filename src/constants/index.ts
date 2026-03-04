import path from "path";

import type Source from "@/types/source";

export const DATA_PATH = path.join(process.cwd(), "data");
export const SENT_PATH = path.join(DATA_PATH, "sent.json");
export const JOB_PATH = path.join(DATA_PATH, "jobs.json");
export const JD_PATH = path.join(DATA_PATH, "jd");

export const TARGET_SEASONS = [
  "Summer 2026",
  "Fall 2026",
  "Spring 2027",
  "Winter 2027",
  "off-season",
] as const;

export const LOCATIONS = ["USA", "Canada", "UK", "Other"] as const;
export type Location = (typeof LOCATIONS)[number];

export const SOURCES: Source[] = [
  {
    name: "vansh",
    url: "https://raw.githubusercontent.com/vanshb03/Summer2026-Internships/dev/README.md",
    format: "markdown",
    type: "summer",
  },
  {
    name: "vansh-off-season",
    url: "https://raw.githubusercontent.com/vanshb03/Summer2026-Internships/refs/heads/dev/OFFSEASON_README.md",
    format: "markdown",
    type: "off-season",
  },
  {
    name: "simplify",
    url: "https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/README.md",
    format: "html",
    type: "summer",
  },
  {
    name: "simplify-off-season",
    url: "https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/refs/heads/dev/README-Off-Season.md",
    format: "html",
    type: "off-season",
  },
  {
    name: "simplify-new-grad",
    url: "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/refs/heads/dev/README.md",
    format: "html",
    type: "new-grad",
    disabled: true,
  },
];
