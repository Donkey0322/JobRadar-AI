import fs from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { JobCategory } from "@/constants/job-category";
import { getSeasonYears } from "@/constants/season";

import type { Config } from "@/config";
import type { JD, Opportunity } from "@/types/jobs";

const writeFile = vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
const mkdir = vi.spyOn(fs, "mkdir").mockResolvedValue(undefined);
const readdir = vi.spyOn(fs, "readdir").mockResolvedValue([]);
vi.spyOn(fs, "rm").mockResolvedValue(undefined);
const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as typeof process.exit);

const { renderBoard } = await import("../render");

const importedWithoutWriting =
  writeFile.mock.calls.length === 0 &&
  mkdir.mock.calls.length === 0 &&
  readdir.mock.calls.length === 0 &&
  exit.mock.calls.length === 0;

writeFile.mockRestore();
mkdir.mockRestore();
readdir.mockRestore();
exit.mockRestore();

const GENERATED_AT = new Date("2026-01-15T12:00:00.000Z");
const FIXTURE_DIR = path.join(import.meta.dirname, "fixtures", "board");

const BADGE_FILES = [
  "google.svg",
  "amazon.svg",
  "apple.svg",
  "meta.svg",
  "netflix.svg",
  "tiktok.svg",
  "bytedance.svg",
  "microsoft.svg",
  "amd.svg",
  "nvidia.svg",
  "openai.svg",
  "spacex.svg",
  "stripe.svg",
  "salesforce.svg",
  "adobe.svg",
  "snowflake.svg",
  "databricks.svg",
];

const PAGE_FILES = ["summer-intern.md", "off-season-intern.md", "entry-level.md"];

const config = {
  target: {
    intern: [JobCategory.SUMMER_INTERN, JobCategory.OFF_SEASON_INTERN],
    "full-time": [JobCategory.ENTRY_LEVEL],
    countries: ["USA"],
  },
  ai: { enabled: true, provider: "openai", model: "fixture-model" },
  sender: {
    host: "smtp.fixture.test",
    port: 587,
    user: "fixture",
    email: "board@fixture.test",
  },
  receiver: { emails: ["reader@fixture.test"] },
} satisfies Config;

function job(
  fields: Pick<Opportunity, "company" | "role" | "link" | "postedAt" | "location"> & {
    expired?: boolean;
    jd?: JD | null;
  }
): Opportunity {
  return {
    country: "USA",
    expired: false,
    jd: {
      citizenship: null,
      sponsorship: null,
      qualifications: null,
      country: "USA",
      location: `${fields.location}, USA`,
      category: JobCategory.ENTRY_LEVEL,
      season: "None",
    },
    ...fields,
  };
}

// File order is the reopen signal: an active row is a reopen when a later row is older.
const opportunities: Opportunity[] = [
  job({
    company: "Google",
    role: "Software Engineer Intern",
    link: "https://careers.google.com/jobs/results/123",
    location: "Mountain View, CA",
    postedAt: "2026-03-01T18:00:00.000Z",
    jd: {
      citizenship: true,
      sponsorship: false,
      qualifications: null,
      country: "USA",
      location: "Mountain View, CA, USA",
      category: JobCategory.SUMMER_INTERN,
      season: "None",
    },
  }),
  job({
    company: "Helio Labs",
    role: "Data Intern",
    link: "https://example.com/jobs/helio",
    location: "New York, NY",
    postedAt: "2026-02-15T18:00:00.000Z",
    jd: {
      citizenship: null,
      sponsorship: null,
      qualifications: null,
      country: "USA",
      location: "New York, NY, USA",
      category: JobCategory.OFF_SEASON_INTERN,
      season: "None",
    },
  }),
  job({
    company: "Northwind",
    role: "New Grad Engineer, Platform",
    link: "https://example.com/jobs/northwind-b",
    location: "Seattle, WA",
    postedAt: "2026-01-20T18:00:00.000Z",
    expired: true,
  }),
  job({
    company: "Maple Systems",
    role: "Canada Intern",
    link: "https://example.ca/jobs/maple",
    location: "Toronto, ON",
    postedAt: "2025-06-01T18:00:00.000Z",
    jd: {
      citizenship: null,
      sponsorship: null,
      qualifications: null,
      country: "Canada",
      location: "Toronto, ON, Canada",
      category: JobCategory.SUMMER_INTERN,
      season: "None",
    },
  }),
  job({
    company: "Ghost",
    role: "Hidden Role",
    link: "https://example.com/jobs/incomplete",
    location: "Austin, TX",
    postedAt: "2025-05-01T18:00:00.000Z",
    jd: null,
  }),
  job({
    company: "Northwind",
    role: "New Grad Engineer",
    link: "https://example.com/jobs/northwind-a",
    location: "Seattle, WA",
    postedAt: "2026-02-01T18:00:00.000Z",
  }),
  job({
    company: "Northwind",
    role: "Staff Engineer",
    link: "https://example.com/jobs/northwind-staff",
    location: "Seattle, WA",
    postedAt: "2026-02-10T18:00:00.000Z",
    jd: {
      citizenship: null,
      sponsorship: null,
      qualifications: null,
      country: "USA",
      location: "Seattle, WA, USA",
      category: JobCategory.SENIOR_LEVEL,
      season: "None",
    },
  }),
];

function freezeSeasonYear(text: string): string {
  return text.replaceAll(
    `${getSeasonYears().summer} Summer Intern`,
    "«summer-year» Summer Intern"
  );
}

function thawSeasonYear(text: string): string {
  return text.replaceAll("«summer-year»", String(getSeasonYears().summer));
}

describe("renderBoard", () => {
  beforeAll(() => {
    expect(importedWithoutWriting).toBe(true);
  });

  it("renders README, category pages, and featured badges from a fixed board", async () => {
    const board = renderBoard({ opportunities, config, generatedAt: GENERATED_AT });

    expect(board.pages.map((page) => page.fileName)).toEqual(PAGE_FILES);
    expect(board.badges.map((badge) => badge.fileName)).toEqual(BADGE_FILES);
    expect(board.readme).toContain("🕒 Last updated <code>2026-01-15T12:00:00.000Z</code>");
    expect(board.readme).toContain("Updated-2026--01--15-orange");
    expect(board.readme).toContain(
      '<img height="28" alt="Google" src="./assets/featured-badges/google.svg" />'
    );
    expect(board.readme).toContain(">Northwind</td>");
    expect(board.readme).toContain(">↳</td>");
    expect(board.readme).toContain('alt="citizen only"');
    expect(board.readme).toContain('alt="no visa"');
    expect(board.readme).toContain('alt="reopen"');
    expect(board.readme).toContain('alt="apply (expired)"');
    expect(board.readme).not.toContain("Maple Systems");
    expect(board.readme).not.toContain("Hidden Role");
    expect(board.readme).not.toContain("Staff Engineer");

    const readme = freezeSeasonYear(board.readme);
    const pages = board.pages.map((page) => ({
      ...page,
      markdown: freezeSeasonYear(page.markdown),
    }));

    expect(readme).toContain("«summer-year» Summer Intern");
    expect(pages[0]?.markdown).toContain("«summer-year» Summer Intern");
    expect(readme).toBe(await fs.readFile(path.join(FIXTURE_DIR, "README.md"), "utf-8"));

    for (const page of pages) {
      expect(page.markdown).toContain("Last updated <code>2026-01-15T12:00:00.000Z</code>");
      expect(page.markdown).toBe(
        await fs.readFile(path.join(FIXTURE_DIR, "pages", page.fileName), "utf-8")
      );
    }

    const summer = pages.find((page) => page.fileName === "summer-intern.md");
    const entry = pages.find((page) => page.fileName === "entry-level.md");
    expect(summer?.markdown).toContain('src="../assets/featured-badges/google.svg"');
    expect(entry?.markdown).toContain(">Northwind</td>");
    expect(entry?.markdown).toContain(">↳</td>");
    expect(entry?.markdown).toContain('alt="apply (expired)"');

    for (const badge of board.badges) {
      expect(badge.svg).toContain("<!-- generated by scripts/readme.ts -->");
      expect(badge.svg).toBe(
        await fs.readFile(path.join(FIXTURE_DIR, "badges", badge.fileName), "utf-8")
      );
    }

    expect(thawSeasonYear("«summer-year» Summer Intern")).toBe(
      `${getSeasonYears().summer} Summer Intern`
    );
  });
});
