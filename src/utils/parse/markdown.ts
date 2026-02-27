import type { Job } from "@/types";
import { containsExcludedSymbols, getToday, HREF_RE, cleanLink } from "@/utils/string";

export default function parseMarkdown(md: string): Job[] {
  const ROW_START = /^\s*\|/; // regex to match the start of a row: "|"
  const jobs: Job[] = [];

  let lastCompany: string | null = null;
  const today = getToday();
  for (const rawLine of md.split("\n")) {
    // remove trailing whitespace in the right side of the line
    const line = rawLine.replace(/\s+$/, "");

    if (!ROW_START.test(line)) continue;
    if (containsExcludedSymbols(line)) continue;

    // after filtering, we get the line like this:
    // | Company | Role | Location | Application/Link | Date Posted |
    const jobData = line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "") // remove the start and end |
      .split("|")
      .map((p) => p.trim());
    if (jobData.length < 5) continue;

    const [company, role, location, linkTag, date] = jobData;

    // only get the jobs posted today
    if (date !== today) continue;

    /* ======= deal with the link ======== */
    const link = linkTag.match(HREF_RE)?.[1];
    if (!link) continue;
    const cleanedLink = cleanLink(link);

    /* ======= deal with the company ======== */
    let current = company;
    if (company.includes("↳")) {
      current = lastCompany ?? "Unknown";
    } else {
      lastCompany = current;
    }

    jobs.push({
      company: current,
      role,
      link: cleanedLink,
      location,
    });
  }

  return jobs;
}
