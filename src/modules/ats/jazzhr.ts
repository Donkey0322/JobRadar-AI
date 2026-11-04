import * as cheerio from "cheerio";

import { cleanText } from "@/utils/text";
import { getHostnameWithoutWww } from "@/utils/url";

/**
 * `/apply/{id}/{slug}` or `/apply/jobs/details/{id}`. IDs are 10 mixed-case
 * characters; requiring a capital or digit keeps words like "internship" out.
 */
const JAZZHR_JOB_PATH =
  /^\/apply\/(?:jobs\/details\/)?((?=[a-z]*[A-Z0-9])[A-Za-z0-9]{10})(?:\/[^/]*)?\/?$/;
const ROW_TIMESTAMP = /^row_job_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_/;

export interface JazzHRJob {
  jobId: string;
  title: string;
  location: string;
  postedDate: string;
}

export function isJazzHRHost(url: URL): boolean {
  return url.hostname.endsWith("applytojob.com");
}

export function isJazzHRUrl(url: URL): boolean {
  return isJazzHRHost(url) || JAZZHR_JOB_PATH.test(url.pathname);
}

export function getJazzHRJobId(pathname: string): string | null {
  const match = pathname.match(JAZZHR_JOB_PATH);
  return match?.[1] ?? null;
}

export function jazzHRListingUrl(url: URL): string {
  return `${url.origin}/apply/jobs`;
}

export function jazzHRJobUrl(origin: string, id: string): string {
  return `${origin}/apply/${id}`;
}

/** `row_job_20260903192931_…` → when the job was created in JazzHR. */
export function jazzHRRowDate(rowId: string): string {
  const match = rowId.match(ROW_TIMESTAMP);
  if (!match) return "";

  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
}

export function parseJazzHRListing(html: string): JazzHRJob[] {
  const $ = cheerio.load(html);
  const jobs: JazzHRJob[] = [];
  const seen = new Set<string>();

  $("#jobs_table tr[id^='row_job_']").each((_, el) => {
    const row = $(el);
    const anchor = row.find("a.job_title_link").first();
    const jobId = getJazzHRJobId((anchor.attr("href") ?? "").split("?")[0]);
    const title = cleanText(anchor.text());
    if (!jobId || !title || seen.has(jobId)) return;

    seen.add(jobId);
    jobs.push({
      jobId,
      title,
      location: cleanText(row.find("td").eq(1).text()),
      postedDate: jazzHRRowDate(row.attr("id") ?? ""),
    });
  });

  return jobs;
}

/** Employer name from the board's `Organization` JSON-LD. */
export function parseJazzHRCompanyName(html: string): string | null {
  const $ = cheerio.load(html);

  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const data = JSON.parse($(el).text()) as { "@type"?: unknown; name?: unknown };
      if (data["@type"] === "Organization" && typeof data.name === "string" && data.name.trim()) {
        return data.name.trim();
      }
    } catch {
      continue;
    }
  }

  return null;
}

/** Fallback name: `neboagency.applytojob.com` → `neboagency`, else the host. */
export function jazzHRHostName(url: URL): string {
  const host = getHostnameWithoutWww(url);
  return isJazzHRHost(url) ? host.split(".")[0] : host;
}
