import * as cheerio from "cheerio";

import type { Job } from "@/types";

import { cleanLink } from "@/utils/string";

function normalizeText(s: string): string {
  const normalized = s.normalize("NFKC").trim();
  return normalized.replace(/^[🔥⭐→↳·•\-–—\s]+/u, "").trim();
}

function getColumnIndexes($: cheerio.CheerioAPI, table: ReturnType<typeof $>) {
  // Summer:     Company | Role | Location | Application | Age
  // Off-season: Company | Role | Location | Terms | Application | Age
  const headers = table
    .find("thead th")
    .map((_, th) => $(th).text().trim().toLowerCase())
    .get();

  const indexOf = (...names: string[]) =>
    headers.findIndex((header) => names.some((name) => header.includes(name)));

  return {
    company: indexOf("company"),
    role: indexOf("role"),
    location: indexOf("location"),
    application: indexOf("application", "link"),
    age: indexOf("age"),
  };
}

function parseTable($: cheerio.CheerioAPI, table: ReturnType<typeof $>): Job[] {
  const items: Job[] = [];
  const tbody = table.find("tbody");
  if (!tbody.length) return items;

  const columns = getColumnIndexes($, table);
  if (
    columns.company < 0 ||
    columns.role < 0 ||
    columns.location < 0 ||
    columns.application < 0 ||
    columns.age < 0
  ) {
    return items;
  }

  let lastCompany: string | null = null;

  tbody.find("tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (
      tds.length <=
      Math.max(columns.company, columns.role, columns.location, columns.application, columns.age)
    ) {
      return;
    }

    const company = tds.eq(columns.company).text().trim();
    const role = tds.eq(columns.role).text().trim();
    const location = tds.eq(columns.location).text().trim();
    const age = tds.eq(columns.age).text().trim().toLowerCase();

    if (age !== "0d") return;

    const appCell = tds.eq(columns.application);
    const aTag = appCell.find("a[href]").first();
    if (!aTag.length) return;
    const cleanedLink = cleanLink(aTag.attr("href")!.trim());

    let current: string;
    if (company === "↳") {
      current = lastCompany ?? "Unknown";
    } else {
      current = normalizeText(company);
      lastCompany = current;
    }

    items.push({
      company: current,
      role,
      location,
      link: cleanedLink,
    });
  });

  return items;
}

export default function parseHtml(html: string): Job[] {
  const $ = cheerio.load(html);
  const jobs: Job[] = [];

  $("table").each((_, table) => {
    const opportunities = parseTable($, $(table));
    jobs.push(...opportunities);
  });

  return jobs;
}
