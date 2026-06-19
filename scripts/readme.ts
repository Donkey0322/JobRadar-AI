import fs from "node:fs/promises";
import path from "node:path";

import { CONFIG, JOB_CATEGORIES, OPPORTUNITIES_PATH } from "@/constants";

import type { JD, Opportunity } from "@/types/jobs";
import type { Config } from "@/validation/config";

type TableRow = [string, string, string, string, string];

type JDWithLocation = JD & {
  location?: string | null;
};

const ROOT = process.cwd();

const README_PATH = path.join(ROOT, "README.md");

const BADGE_CITIZENSHIP = `<img alt="citizen only" src="https://img.shields.io/badge/citizen%20only-ff6b6b?style=soft" />`;

const BADGE_NO_SPONSORSHIP = `<img alt="no visa" src="https://img.shields.io/badge/no%20visa-60a5fa?style=soft" />`;

const APPLY_BUTTON_SRC =
  "https://img.shields.io/badge/Apply-f97316?style=for-the-badge&logoColor=white";

async function main() {
  const opportunities = await readNdjson<Opportunity>(OPPORTUNITIES_PATH);

  const allowedCountries = new Set(CONFIG.target.countries.map(normalizeCountry));
  const categoryOrder = buildCategoryOrder(CONFIG);

  const filtered = opportunities
    .reverse()
    .filter((job) => isRenderableOpportunity(job))
    .filter((job) => {
      const country = normalizeCountry(job.jd?.country);
      return country ? allowedCountries.has(country) : false;
    });

  const grouped = groupByCategory(filtered, categoryOrder);

  const markdown = buildReadme({
    config: CONFIG,
    opportunities: filtered,
    grouped,
    categoryOrder,
  });

  await fs.writeFile(README_PATH, markdown, "utf-8");

  console.log(`README generated: ${README_PATH}`);
  console.log(`Opportunities included: ${filtered.length}`);
}

async function readNdjson<T>(filePath: string): Promise<T[]> {
  const raw = await fs.readFile(filePath, "utf-8");

  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as T;
      } catch (error) {
        throw new Error(`Invalid NDJSON at line ${index + 1}: ${line}`, {
          cause: error,
        });
      }
    });
}

function buildCategoryOrder(config: Config): string[] {
  return unique(
    [...(config.target.intern ?? []), ...(config.target["full-time"] ?? []), ...JOB_CATEGORIES].map(
      normalizeCategory
    )
  );
}

function groupByCategory(
  opportunities: Opportunity[],
  categoryOrder: string[]
): Map<string, Opportunity[]> {
  const groups = new Map<string, Opportunity[]>();

  for (const job of opportunities) {
    const category = getDisplayCategory(job);

    if (!groups.has(category)) {
      groups.set(category, []);
    }

    groups.get(category)!.push(job);
  }

  const knownOrder = new Map(categoryOrder.map((category, index) => [category, index]));

  return new Map(
    [...groups.entries()].sort(([categoryA], [categoryB]) => {
      const orderA = knownOrder.get(categoryA) ?? Number.MAX_SAFE_INTEGER;
      const orderB = knownOrder.get(categoryB) ?? Number.MAX_SAFE_INTEGER;

      if (orderA !== orderB) return orderA - orderB;

      return categoryA.localeCompare(categoryB);
    })
  );
}

function buildReadme(input: {
  config: Config;
  opportunities: Opportunity[];
  grouped: Map<string, Opportunity[]>;
  categoryOrder: string[];
}): string {
  const { config, opportunities, grouped } = input;

  const generatedAt = new Date();
  const generatedDate = generatedAt.toISOString().slice(0, 10);

  const aiParser = formatAiParser(config);
  const countries = formatCountries(config);

  const lines: string[] = [];

  lines.push(`# JobRadar AI 🚀`);
  lines.push("");
  lines.push(
    `<p align="center">`,
    `  <b>Fresh tech opportunities from ATS APIs, community lists, and AI-parsed job descriptions.</b>`,
    `</p>`,
    ``,
    `<p align="center">`,
    `  <img src="${formatBadgeUrl("Source", "opportunities.ndjson", "black")}" />`,
    `  <img src="${formatBadgeUrl("AI Parsed", aiParser, "blue")}" />`,
    `  <img src="${formatBadgeUrl("Countries", countries, "green")}" />`,
    `  <img src="${formatBadgeUrl("Updated", generatedDate, "orange")}" />`,
    `</p>`
  );
  lines.push("");
  lines.push(`---`);
  lines.push("");
  lines.push(
    `<div align="center">`,
    `  <h2>Find better opportunities before everyone else does.</h2>`,
    `  <p>`,
    `    JobRadar AI tracks software, data, AI, infrastructure, security, product, and other tech roles`,
    `    directly from company career systems and community job boards.`,
    `  </p>`,
    `  <p>`,
    `    Instead of being just another manually curated link list, it combines scheduled ATS discovery,`,
    `    community-source sync, job-description crawling, and AI signal parsing into one structured opportunity board.`,
    `  </p>`,
    `</div>`
  );
  lines.push("");
  lines.push(`---`);
  lines.push("");
  lines.push(`## Why JobRadar AI is different`);
  lines.push("");
  lines.push(
    `- 🔎 **Closer to the source** — discovers roles from original ATS and company career APIs, not only reposted or manually submitted links.`
  );
  lines.push(
    `- ⏱️ **Built for freshness** — runs on a schedule to keep tracking newly opened opportunities as they appear.`
  );
  lines.push(
    `- 🌐 **Broader coverage** — syncs community job lists while also expanding coverage through direct company-source discovery.`
  );
  lines.push(
    `- 🧠 **More than a job title** — crawls job descriptions and parses signals like category, country, sponsorship, citizenship, and qualifications.`
  );
  lines.push(
    `- 📊 **Higher-signal rows** — each opportunity is enriched with structured metadata, making it easier to judge relevance at a glance.`
  );
  lines.push(
    `- 🧭 **Search-strategy aware** — countries and target categories come from \`config.json\`, so the board reflects the roles you actually care about.`
  );
  lines.push("");
  lines.push(`## The List 🚴‍♂️`);
  lines.push("");
  lines.push(`<!-- TABLE_START -->`);
  lines.push("");

  if (opportunities.length === 0) {
    lines.push(`No matching opportunities found.`);
    lines.push("");
    lines.push(`<!-- TABLE_END -->`);
    lines.push("");
    return lines.join("\n");
  }

  for (const [category, jobs] of grouped) {
    lines.push(`### ${formatCategoryTitle(category)}`);
    lines.push("");

    const rows: TableRow[] = [];
    let previousCompany = "";

    for (const job of jobs) {
      const company = normalizeCompany(job.company);
      const companyCell = company === previousCompany ? "↳" : company;
      previousCompany = company;

      rows.push([
        escapeHtml(companyCell),
        formatRoleCell(job),
        escapeHtml(formatLocation(job)),
        formatApplyButton(job.link),
        formatDate(job.postedAt),
      ]);
    }

    lines.push(...buildHtmlTable(["Company", "Role", "Location", "Link", "Date"], rows));

    lines.push("");
  }

  lines.push(`<!-- TABLE_END -->`);
  lines.push("");
  lines.push(`---`);
  lines.push("");
  lines.push(
    `<p align="center">`,
    `  Generated from <code>opportunities.ndjson</code> · Last updated: <code>${generatedAt.toISOString()}</code>`,
    `</p>`
  );
  lines.push("");

  return lines.join("\n");
}

function isRenderableOpportunity(job: Opportunity): boolean {
  return Boolean(
    job.company?.trim() &&
    job.role?.trim() &&
    job.link?.trim() &&
    job.postedAt?.trim() &&
    job.jd?.country &&
    job.jd?.category
  );
}

function getDisplayCategory(job: Opportunity): string {
  const category = normalizeCategory(job.jd?.category);
  const season = normalizeCategory(job.jd?.season);

  if (category === "intern" && season && season !== "none") {
    return season;
  }

  return category || "None";
}

function formatRoleCell(job: Opportunity): string {
  const role = escapeHtml(job.role);
  const badges = formatJobBadges(job.jd);

  if (!badges) return role;

  return `${role}<br />${badges}`;
}

function formatJobBadges(jd?: JD | null): string {
  if (!jd) return "";

  const badges: string[] = [];

  if (jd.citizenship === true) {
    badges.push(BADGE_CITIZENSHIP);
  }

  if (jd.sponsorship === false) {
    badges.push(BADGE_NO_SPONSORSHIP);
  }

  return badges.join(" ");
}

function formatLocation(job: Opportunity): string {
  const parsedLocation = (job.jd as JDWithLocation | null | undefined)?.location;
  const location = parsedLocation?.trim() || job.location?.trim();

  if (!location) return "-";

  return location
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(", ");
}

function formatApplyButton(link: string): string {
  return `<a href="${escapeHtmlAttr(link)}" target="_blank"><img alt="apply" src="${APPLY_BUTTON_SRC}" /></a>`;
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return escapeHtml(value);
  }

  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatCategoryTitle(category: string): string {
  if (!category || category === "None") return "Other";

  return category
    .split(/[\s-_]+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

function buildHtmlTable(headers: TableRow, rows: TableRow[]): string[] {
  const columnWidths = ["180", "420", "180", "120", "100"];

  const lines: string[] = [];

  lines.push(`<table width="100%">`);
  lines.push(`  <thead>`);
  lines.push(`    <tr>`);

  headers.forEach((header, index) => {
    lines.push(
      `      <th width="${columnWidths[index]}" align="left" valign="top">${escapeHtml(
        header
      )}</th>`
    );
  });

  lines.push(`    </tr>`);
  lines.push(`  </thead>`);
  lines.push(`  <tbody>`);

  for (const row of rows) {
    lines.push(`    <tr>`);

    row.forEach((cell, index) => {
      lines.push(`      <td width="${columnWidths[index]}" align="left" valign="top">${cell}</td>`);
    });

    lines.push(`    </tr>`);
  }

  lines.push(`  </tbody>`);
  lines.push(`</table>`);

  return lines;
}

function formatAiParser(config: Config): string {
  return [config.ai?.provider, config.ai?.model].filter(Boolean).join(" / ") || "enabled";
}

function formatCountries(config: Config): string {
  return config.target.countries.join(" · ") || "configured";
}

function formatBadgeUrl(label: string, message: string, color: string): string {
  return `https://img.shields.io/badge/${encodeBadgeSegment(label)}-${encodeBadgeSegment(
    message
  )}-${encodeBadgeSegment(color)}`;
}

function encodeBadgeSegment(value: string): string {
  return encodeURIComponent(value).replaceAll("-", "--");
}

function normalizeCategory(value?: string | null): string {
  const normalized = value?.trim();

  if (!normalized) return "None";

  return normalized.toLowerCase();
}

function normalizeCountry(value?: string | null): string {
  return value?.trim() ?? "";
}

function normalizeCompany(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeHtmlAttr(value: string): string {
  return escapeHtml(value);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
