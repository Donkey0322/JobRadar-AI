import * as cheerio from "cheerio";

import { YEAR } from "@/constants";

import type { Job, Source } from "@/types";

import { cleanLink, containsExcludedSymbols, normalizeSeason } from "@/utils/string";
import { JobCategory } from "@/validation/config";
import { SeasonSchema } from "@/validation/season";

function normalizeText(s: string): string {
  // remove the whitespace, common decoration emoji and extra whitespace
  const normalized = s.normalize("NFKC").trim();

  // remove the prefix symbols (🔥、↳ etc.)
  return normalized.replace(/^[🔥⭐→↳·•\-–—\s]+/u, "").trim();
}

function findSoftwareTable($: cheerio.CheerioAPI) {
  // find the h2/h3 contains "Software Engineering Internship Roles"
  const headings = $("h2, h3");

  for (let i = 0; i < headings.length; i++) {
    const el = headings.eq(i);
    const text = el.text().toLowerCase();

    if (text.includes("software engineering internship roles")) {
      const table = el.nextAll("table").first();
      if (table.length) return table;
    }
  }

  // fallback: the first table
  return $("table").first();
}

export default function parseHtml(html: string, source: Source): Job[] {
  const items: Job[] = [];

  const $ = cheerio.load(html);
  const table = findSoftwareTable($);
  if (!table || table.length === 0) return items;

  const tbody = table.find("tbody");
  if (!tbody || tbody.length === 0) return items;

  let lastCompany: string | null = null;

  tbody.find("tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 5) return;

    // after filtering, we get the line like this:
    // | Company | Role | Location | Season | Application/Link | Age |
    const cols = tds.map((_, td) => $(td).text().trim()).get();
    if (cols.length === 5) {
      const season = source.type === JobCategory.ENTRY_LEVEL ? "Entry Level" : `${YEAR} Summer`;
      cols.splice(3, 0, season);
      tds.splice(3, 0, `<td>${season}</td>`);
    }
    const [company, role, location, season, , age] = cols;

    /* ======= deal with the company ======== */
    if (containsExcludedSymbols(company)) return;

    let current: string;
    if (company === "↳") {
      current = lastCompany ?? "Unknown";
    } else {
      current = normalizeText(company);
      lastCompany = current;
    }

    /* ======= deal with the role ======== */
    if (containsExcludedSymbols(role)) return;

    /* ======= deal with the season ======== */
    const normalizedSeason = normalizeSeason(season);
    const seasonParsed = SeasonSchema.safeParse(normalizedSeason);
    if (!seasonParsed.success) {
      return;
    }

    /* ======= deal with the link ======== */
    const appCell = tds.eq(4);
    const aTag = appCell.find("a[href]").first();
    if (!aTag.length) return;
    const cleanedLink = cleanLink(aTag.attr("href")!.trim());

    /* ======= deal with the age ======== */
    const ageText = age.toLowerCase();
    if (ageText !== "0d") return;

    /* ======= check the row ======== */
    const rowText = tds
      .map((_, td) => $(td).text().trim())
      .get()
      .join(" ");

    if (containsExcludedSymbols(rowText)) return;

    items.push({
      company: current,
      role,
      link: cleanedLink,
      location,
      season: seasonParsed.data,
    });
  });

  return items;
}
