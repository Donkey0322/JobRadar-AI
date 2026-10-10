import type { Job } from "@/types";

import { cleanLink, getToday, HREF_RE } from "@/utils/string";

function normalizeText(s: string): string {
  const normalized = s.replace(/\*\*/g, "").normalize("NFKC").trim();
  return normalized.replace(/^[🔥⭐→↳·•\-–—\s]+/u, "").trim();
}

function parseCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((part) => part.trim());
}

function isSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

function getColumnIndexes(headers: string[]) {
  // Summer:     Company | Role | Location | Application/Link | Date Posted
  // Off-season: Company | Role | Location | Terms | Application/Link | Date Posted
  const normalized = headers.map((header) => header.toLowerCase());
  const indexOf = (...names: string[]) =>
    normalized.findIndex((header) => names.some((name) => header.includes(name)));

  return {
    company: indexOf("company"),
    role: indexOf("role"),
    location: indexOf("location"),
    application: indexOf("application", "link"),
    date: indexOf("date", "age"),
  };
}

function isHeader(cells: string[]): boolean {
  const columns = getColumnIndexes(cells);
  return (
    columns.company >= 0 &&
    columns.role >= 0 &&
    columns.location >= 0 &&
    columns.application >= 0 &&
    columns.date >= 0
  );
}

export default function parseMarkdown(md: string, today = getToday()): Job[] {
  const jobs: Job[] = [];
  let lastCompany: string | null = null;
  let columns: ReturnType<typeof getColumnIndexes> | null = null;

  for (const rawLine of md.split("\n")) {
    const line = rawLine.replace(/\s+$/, "");
    if (!/^\s*\|/.test(line)) continue;

    const cells = parseCells(line);
    if (cells.length < 5) continue;

    if (isSeparator(cells)) continue;

    if (isHeader(cells)) {
      columns = getColumnIndexes(cells);
      lastCompany = null;
      continue;
    }

    if (!columns) continue;

    const required = Math.max(
      columns.company,
      columns.role,
      columns.location,
      columns.application,
      columns.date
    );
    if (cells.length <= required) continue;

    if (cells[columns.date] !== today) continue;

    const link = cells[columns.application].match(HREF_RE)?.[1];
    if (!link) continue;
    const cleanedLink = cleanLink(link);

    const company = cells[columns.company];
    let current: string;
    if (company === "↳") {
      current = lastCompany ?? "Unknown";
    } else {
      current = normalizeText(company);
      lastCompany = current;
    }

    jobs.push({
      company: current,
      role: cells[columns.role],
      location: cells[columns.location],
      link: cleanedLink,
    });
  }

  return jobs;
}
