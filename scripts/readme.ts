import fs from "node:fs/promises";
import path from "node:path";

import { CONFIG, JOB_CATEGORIES, OPPORTUNITIES_PATH } from "@/constants";
import { getSeasonYears } from "@/constants/season";

import type { JD, Opportunity } from "@/types/jobs";
import type { Config } from "@/validation/config";

import { getJobKey } from "@/modules/job-dedup";
import { readNdjsonFile } from "@/utils/data";
import { escapeHtml } from "@/utils/html";

type TableRow = [string, string, string, string, string];

type JDWithLocation = JD & {
  location?: string | null;
};

const ROOT = process.cwd();

const README_PATH = path.join(ROOT, "README.md");
const JOB_POSTINGS_DIR = path.join(ROOT, "job-postings");

const REPO_OWNER = "Donkey0322";
const REPO_NAME = "JobRadar-AI";
const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;
const TEMPLATE_URL = `https://github.com/new?template_name=${REPO_NAME}&template_owner=${REPO_OWNER}`;
const ISSUE_TEMPLATE_URL = `${REPO_URL}/issues/new/choose`;

const MAX_JOBS_PER_README_SECTION = 20;
const MAX_JOBS_PER_CATEGORY_PAGE = 100;

const BADGE_CITIZENSHIP = `<img height="18" alt="citizen only" src="https://img.shields.io/badge/citizen%20only-ff6b6b?style=plastic" />`;

const BADGE_NO_SPONSORSHIP = `<img height="18" alt="no visa" src="https://img.shields.io/badge/no%20visa-60a5fa?style=plastic" />`;

const BADGE_REOPEN = `<img height="18" alt="reopen" src="https://img.shields.io/badge/reopen-eab308?style=plastic" />`;

const APPLY_BUTTON_SRC =
  "https://img.shields.io/badge/Apply-f97316?style=for-the-badge&logoColor=white";
const EXPIRED_APPLY_BUTTON_SRC =
  "https://img.shields.io/badge/Apply-9ca3af?style=for-the-badge&logoColor=white";

/** Job keys inferred as in-place reopen (fresher postedAt than rows appended after them). */
let reopenedJobKeys = new Set<string>();

async function main() {
  const opportunities = await readNdjsonFile<Opportunity>(OPPORTUNITIES_PATH);
  reopenedJobKeys = detectReopenedKeys(opportunities);

  const allowedCountries = new Set(CONFIG.target.countries.map(normalizeCountry));
  const targetCategories = new Set(buildTargetCategories(CONFIG));
  const categoryOrder = buildCategoryOrder(CONFIG);
  const generatedAt = new Date();

  const countryMatched = opportunities
    .filter((job) => isRenderableOpportunity(job))
    .filter((job) => {
      const country = normalizeCountry(job.jd?.country);
      return country ? allowedCountries.has(country) : false;
    })
    .sort(comparePostedAtDesc);

  const targetOpportunities = countryMatched.filter((job) => {
    const category = getDisplayCategory(job);
    return targetCategories.has(category);
  });

  const outsideTargetCategoryOpportunities = countryMatched.filter((job) => {
    const category = getDisplayCategory(job);
    return !targetCategories.has(category);
  });

  const grouped = groupByCategory(targetOpportunities, categoryOrder);
  const outsideTargetCategoryGrouped = groupByCategory(
    outsideTargetCategoryOpportunities,
    categoryOrder
  );
  const allGrouped = groupByCategory(countryMatched, categoryOrder);

  const markdown = buildReadme({
    config: CONFIG,
    targetOpportunities,
    grouped,
    outsideTargetCategoryOpportunities,
    outsideTargetCategoryGrouped,
    allGrouped,
    generatedAt,
  });

  await writeCategoryPages(allGrouped, generatedAt);
  await fs.writeFile(README_PATH, markdown, "utf-8");

  console.log(`README generated: ${README_PATH}`);
  console.log(`Category pages generated: ${allGrouped.size}`);
  console.log(`Target opportunities included: ${targetOpportunities.length}`);
  console.log(
    `Same-country opportunities outside target categories included in toggle: ${outsideTargetCategoryOpportunities.length}`
  );
}

function buildTargetCategories(config: Config): string[] {
  return unique([
    ...(config.target.intern ?? []).map(normalizeCategory),
    ...(config.target["full-time"] ?? []).map(normalizeCategory),
  ]);
}

function buildCategoryOrder(config: Config): string[] {
  return unique([...buildTargetCategories(config), ...JOB_CATEGORIES.map(normalizeCategory)]);
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

  return sortCategoryGroups(groups, categoryOrder);
}

function sortCategoryGroups(
  groups: Map<string, Opportunity[]>,
  categoryOrder: string[]
): Map<string, Opportunity[]> {
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
  targetOpportunities: Opportunity[];
  grouped: Map<string, Opportunity[]>;
  outsideTargetCategoryOpportunities: Opportunity[];
  outsideTargetCategoryGrouped: Map<string, Opportunity[]>;
  allGrouped: Map<string, Opportunity[]>;
  generatedAt: Date;
}): string {
  const {
    config,
    targetOpportunities,
    grouped,
    outsideTargetCategoryOpportunities,
    outsideTargetCategoryGrouped,
    allGrouped,
    generatedAt,
  } = input;

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
    `  <img src="${formatBadgeUrl("AI Parsed", aiParser, "blue")}" />`,
    `  <img src="${formatBadgeUrl("Countries", countries, "green")}" />`,
    `  <img src="${formatBadgeUrl("Updated", generatedDate, "orange")}" />`,
    `  <img src="${formatBadgeUrl("License", "MIT", "yellow")}" />`,
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
  lines.push(
    `<p align="center">`,
    `  <b>✨ Use the board below — or generate your own personalized tracker.</b>`,
    `</p>`,
    `<p align="center">`,
    `  Bring your own targets, email notifications, schedule, and AI model. Follow`,
    `  <a href="./installation.md"><b>installation.md</b></a> to set it up, or browse the public board below.`,
    `</p>`
  );

  lines.push("");
  lines.push(
    `<p align="center">`,
    `  <a href="${TEMPLATE_URL}">`,
    `    <img alt="Use this template" src="https://img.shields.io/badge/Use%20this%20template-f43f5e?style=for-the-badge" />`,
    `  </a>`,
    `  <a href="./installation.md">`,
    `    <img alt="Setup guide" src="https://img.shields.io/badge/Setup%20guide-f97316?style=for-the-badge" />`,
    `  </a>`,
    `  <a href="./config.json">`,
    `    <img alt="Customize config" src="https://img.shields.io/badge/Customize%20config-f59e0b?style=for-the-badge" />`,
    `  </a>`,
    `  <a href="${ISSUE_TEMPLATE_URL}">`,
    `    <img alt="Contribute a job" src="https://img.shields.io/badge/Contribute%20a%20job-fb7185?style=for-the-badge" />`,
    `  </a>`,
    `</p>`
  );

  lines.push("");
  lines.push(`---`);
  lines.push("");

  lines.push(`## Why JobRadar AI is different`);
  lines.push("");
  lines.push(...buildFeatureGrid());
  lines.push("");

  lines.push(`## Browse jobs by category`);
  lines.push("");
  lines.push(
    `Each category page shows up to ${MAX_JOBS_PER_CATEGORY_PAGE.toLocaleString()} of the latest opportunities.`
  );
  lines.push("");
  lines.push(...buildCategoryPageLinks(allGrouped));
  lines.push("");

  lines.push(`## The List 🚴‍♂️`);
  lines.push("");
  lines.push(`<!-- TABLE_START -->`);
  lines.push("");

  if (targetOpportunities.length === 0) {
    lines.push(`No opportunities matched the current target categories.`);
    lines.push("");
  } else {
    lines.push(...buildCategorySections(grouped));
  }

  if (outsideTargetCategoryOpportunities.length > 0) {
    lines.push(...buildOutsideTargetCategoryToggle(outsideTargetCategoryGrouped));
  }

  lines.push(`<!-- TABLE_END -->`);
  lines.push("");
  lines.push(...buildFooter(generatedAt));

  return lines.join("\n");
}

function buildCategorySections(grouped: Map<string, Opportunity[]>): string[] {
  const lines: string[] = [];

  for (const [category, jobs] of grouped) {
    lines.push(`### ${formatCategoryTitle(category)}`);
    lines.push("");
    lines.push(...buildOpportunityTable(jobs));
    lines.push("");
  }

  return lines;
}

function buildOutsideTargetCategoryToggle(grouped: Map<string, Opportunity[]>): string[] {
  const total = [...grouped.values()].reduce((sum, jobs) => sum + jobs.length, 0);

  const categoryNames = [...grouped.keys()].map(formatCategoryTitle);
  const summaryTitle = formatToggleSummary(categoryNames, total);

  const lines: string[] = [];

  lines.push(`<details>`);
  lines.push(`  <summary><b>${escapeHtml(summaryTitle)}</b></summary>`);
  lines.push("");
  lines.push(`  <br />`);
  lines.push("");

  for (const [category, jobs] of grouped) {
    lines.push(
      `  <h3>${escapeHtml(formatCategoryTitle(category))} (${jobs.length.toLocaleString()})</h3>`
    );
    lines.push("");
    lines.push(...buildOpportunityTable(jobs));
    lines.push("");
  }

  lines.push(`</details>`);
  lines.push("");

  return lines;
}

function buildOpportunityTable(jobs: Opportunity[]): string[] {
  return buildLimitedOpportunityTable(jobs, MAX_JOBS_PER_README_SECTION);
}

function buildLimitedOpportunityTable(jobs: Opportunity[], limit: number): string[] {
  const visibleJobs = jobs.slice(0, limit);

  const rows: TableRow[] = [];
  let previousCompany = "";

  for (const job of visibleJobs) {
    const company = normalizeCompany(job.company);
    const companyCell = company === previousCompany ? "↳" : company;
    previousCompany = company;

    rows.push([
      escapeHtml(companyCell),
      formatRoleCell(job),
      escapeHtml(formatLocation(job)),
      formatApplyButton(job),
      formatDate(job.postedAt),
    ]);
  }

  const lines = buildHtmlTable(["Company", "Role", "Location", "Link", "Date"], rows);

  if (jobs.length > limit) {
    lines.push(
      `<p><sub>Showing ${limit.toLocaleString()} of ${jobs.length.toLocaleString()} opportunities in this section.</sub></p>`
    );
  }

  return lines;
}

function buildCategoryPageLinks(grouped: Map<string, Opportunity[]>): string[] {
  return [...grouped].map(
    ([category, jobs]) =>
      `- [${formatCategoryTitle(category)}](./job-postings/${categoryFileName(
        category
      )}) — ${jobs.length.toLocaleString()} opportunities`
  );
}

async function writeCategoryPages(
  grouped: Map<string, Opportunity[]>,
  generatedAt: Date
): Promise<void> {
  await fs.mkdir(JOB_POSTINGS_DIR, { recursive: true });

  const existingFiles = await fs.readdir(JOB_POSTINGS_DIR);
  await Promise.all(
    existingFiles
      .filter((fileName) => fileName.endsWith(".md"))
      .map((fileName) => fs.rm(path.join(JOB_POSTINGS_DIR, fileName)))
  );

  await Promise.all(
    [...grouped].map(([category, jobs]) => {
      const pagePath = path.join(JOB_POSTINGS_DIR, categoryFileName(category));
      const markdown = buildCategoryPage(category, jobs, generatedAt);

      return fs.writeFile(pagePath, markdown, "utf-8");
    })
  );
}

function buildCategoryPage(category: string, jobs: Opportunity[], generatedAt: Date): string {
  const title = formatCategoryTitle(category);
  const lines = [
    `# ${title} jobs`,
    ``,
    `[← Back to the main job board](../README.md)`,
    ``,
    ...buildLimitedOpportunityTable(jobs, MAX_JOBS_PER_CATEGORY_PAGE),
    ``,
    `---`,
    ``,
    `<sub>Generated from <code>data/opportunities.ndjson</code> · Last updated <code>${generatedAt.toISOString()}</code></sub>`,
    ``,
  ];

  return lines.join("\n");
}

function categoryFileName(category: string): string {
  const slug = category
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${slug || "other"}.md`;
}

function buildFeatureGrid(): string[] {
  return [
    `<table>`,
    `  <tr>`,
    `    <td width="50%" valign="top">`,
    `      <h3>🔎 Closer to the source</h3>`,
    `      <p>Discovers roles from original ATS and company career APIs, not only reposted or manually submitted links.</p>`,
    `    </td>`,
    `    <td width="50%" valign="top">`,
    `      <h3>⏱️ Built for freshness</h3>`,
    `      <p>Runs on a schedule to keep tracking newly opened opportunities as they appear.</p>`,
    `    </td>`,
    `  </tr>`,
    `  <tr>`,
    `    <td width="50%" valign="top">`,
    `      <h3>🌐 Broader coverage</h3>`,
    `      <p>Combines community lists with Workday, Greenhouse, Ashby, iCIMS, Lever, Oracle Cloud, SmartRecruiters, and more.</p>`,
    `    </td>`,
    `    <td width="50%" valign="top">`,
    `      <h3>🏢 Custom company sources</h3>`,
    `      <p>Adds dedicated sources for high-signal companies like Google, Amazon, Netflix, Apple, Meta, Microsoft, TikTok, and more.</p>`,
    `    </td>`,
    `  </tr>`,
    `  <tr>`,
    `    <td width="50%" valign="top">`,
    `      <h3>🧠 JD-level intelligence</h3>`,
    `      <p>Crawls job descriptions and parses signals like category, country, sponsorship, citizenship, qualifications, and season.</p>`,
    `    </td>`,
    `    <td width="50%" valign="top">`,
    `      <h3>⚙️ Config-driven setup</h3>`,
    `      <p>Tune countries, role targets, email delivery, workflow schedules, and AI model settings through <code>config.json</code>.</p>`,
    `    </td>`,
    `  </tr>`,
    `</table>`,
  ];
}

function buildFooter(generatedAt: Date): string[] {
  return [
    `---`,
    ``,
    `<div align="center">`,
    `  <p>`,
    `    <a href="./PRIVACY.md"><b>🛡️ Privacy</b></a>`,
    `    &nbsp;·&nbsp;`,
    `    <a href="./SECURITY.md"><b>🔐 Security</b></a>`,
    `    &nbsp;·&nbsp;`,
    `    <a href="./LICENSE"><b>📄 License</b></a>`,
    `  </p>`,
    ``,
    `  <p>`,
    `    <span style="color:#374151;">`,
    `      📦 Generated from <code>opportunities.ndjson</code>`,
    `      &nbsp;•&nbsp;`,
    `      🕒 Last updated <code>${generatedAt.toISOString()}</code>`,
    `    </span>`,
    `  </p>`,
    `</div>`,
    ``,
  ];
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

function comparePostedAtDesc(a: Opportunity, b: Opportunity): number {
  return new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime();
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
  const badges = formatOpportunityBadges(job);

  if (!badges) return role;

  return `${role}<br />${badges}`;
}

function formatOpportunityBadges(job: Opportunity): string {
  const badges: string[] = [];

  if (!job.expired && reopenedJobKeys.has(getJobKey(job.link))) {
    badges.push(BADGE_REOPEN);
  }

  badges.push(...formatJobBadges(job.jd));

  return badges.join(" ");
}

function formatJobBadges(jd?: JD | null): string[] {
  if (!jd) return [];

  const badges: string[] = [];

  if (jd.citizenship === true) {
    badges.push(BADGE_CITIZENSHIP);
  }

  if (jd.sponsorship === false) {
    badges.push(BADGE_NO_SPONSORSHIP);
  }

  return badges;
}

/**
 * In-place reopens bump `postedAt` but keep their original file position.
 * New jobs are appended at the end. So an active row whose `postedAt` is newer
 * than something after it in the file was updated in place → reopen.
 */
function detectReopenedKeys(opportunities: Opportunity[]): Set<string> {
  const reopenedKeys = new Set<string>();
  let minPostedAtToTheRight = Number.POSITIVE_INFINITY;

  for (let index = opportunities.length - 1; index >= 0; index--) {
    const job = opportunities[index]!;
    const postedAt = new Date(job.postedAt).getTime();

    if (!job.expired && !Number.isNaN(postedAt) && postedAt > minPostedAtToTheRight) {
      reopenedKeys.add(getJobKey(job.link));
    }

    if (!Number.isNaN(postedAt)) {
      minPostedAtToTheRight = Math.min(minPostedAtToTheRight, postedAt);
    }
  }

  return reopenedKeys;
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

function formatApplyButton(job: Opportunity): string {
  if (job.expired) {
    return `<a aria-disabled="true"><img height="28" alt="apply (expired)" src="${EXPIRED_APPLY_BUTTON_SRC}" /></a>`;
  }

  return `<a href="${escapeHtmlAttr(job.link)}"><img height="28" alt="apply" src="${APPLY_BUTTON_SRC}" /></a>`;
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return escapeHtml(value);
  }

  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });
}

function formatCategoryTitle(category: string): string {
  if (!category || category === "None") return "Other";

  const title = category
    .split(/[\s-_]+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");

  if (normalizeCategory(category) === "summer intern") {
    return `${getSeasonYears().summer} ${title}`;
  }

  return title;
}

function formatToggleSummary(categories: string[], total: number): string {
  if (categories.length === 0) {
    return `More opportunities (${total.toLocaleString()})`;
  }

  if (categories.length <= 3) {
    return `More in ${formatHumanList(categories)} (${total.toLocaleString()})`;
  }

  const visible = categories.slice(0, 3);

  return `More in ${formatHumanList(visible)} and ${
    categories.length - visible.length
  } more (${total.toLocaleString()})`;
}

function formatHumanList(values: string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} & ${values[1]}`;

  return `${values.slice(0, -1).join(", ")} & ${values.at(-1)}`;
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
  if (!config.ai?.enabled) return "disabled";

  const provider = config.ai.provider;
  const model = config.ai.model;

  if (provider && model) {
    return `${provider} / ${model}`;
  }

  return "enabled";
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
