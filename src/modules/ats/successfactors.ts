import * as cheerio from "cheerio";

import { cleanText } from "@/utils/string";
import { getHostnameWithoutWww } from "@/utils/url";

/** Career Site Builder job page: `/{optional site path}/job/{slug}/{id}/`. */
const SUCCESSFACTORS_JOB_PATH = /^(?:\/[^/]+)?\/job\/[^/]+\/(\d{6,})\/?$/i;

const TITLE_LOCATION = /^(?<title>.*\S)\s*\((?<location>[^()]*,[^()]*)\)\s*$/;

/** RSS feed names that are internal tenant codes, not the employer. */
const COMPANY_NAMES: Record<string, string> = {
  "jobs.l3harris.com": "L3Harris",
};

export interface SuccessFactorsJob {
  jobId: string;
  title: string;
  link: string;
  location: string;
  postedDate: string;
}

export function isSuccessFactorsJobUrl(url: URL): boolean {
  return SUCCESSFACTORS_JOB_PATH.test(url.pathname);
}

export function isSuccessFactorsUrl(url: URL): boolean {
  return (
    url.hostname.endsWith("jobs2web.com") ||
    url.searchParams.get("ats")?.toLowerCase() === "successfactors" ||
    isSuccessFactorsJobUrl(url)
  );
}

export function getSuccessFactorsJobId(pathname: string): string | null {
  return pathname.match(SUCCESSFACTORS_JOB_PATH)?.[1] ?? null;
}

export function getSuccessFactorsFeedUrl(url: URL): string {
  const feed = new URL("/services/rss/job/", url.origin);
  feed.searchParams.set("locale", "en_US");
  return feed.toString();
}

/** Job page URL without the feed's `feedId` / `utm_*` tracking query. */
export function cleanSuccessFactorsLink(link: string): string {
  const url = new URL(link);
  return `${url.origin}${url.pathname}`;
}

/** "Software Engineer (Richardson, TX, US, 75080)" → title and location. */
export function splitSuccessFactorsTitle(raw: string): { title: string; location: string } {
  const text = cleanText(raw);
  const match = text.match(TITLE_LOCATION);

  if (!match?.groups) {
    return { title: text, location: "" };
  }

  return { title: match.groups.title, location: match.groups.location.trim() };
}

export function parseSuccessFactorsFeed(xml: string): SuccessFactorsJob[] {
  const $ = cheerio.load(xml, { xml: true });
  const jobs: SuccessFactorsJob[] = [];
  const seen = new Set<string>();

  $("item").each((_, el) => {
    const item = $(el);
    const rawLink = item.find("link").first().text().trim();

    let link: string;
    try {
      link = cleanSuccessFactorsLink(rawLink);
    } catch {
      return;
    }

    const jobId = getSuccessFactorsJobId(new URL(link).pathname);
    if (!jobId || seen.has(jobId)) return;

    const { title, location } = splitSuccessFactorsTitle(item.find("title").first().text());
    if (!title) return;

    seen.add(jobId);
    jobs.push({
      jobId,
      title,
      link,
      location,
      postedDate: item.find("pubDate").first().text().trim(),
    });
  });

  return jobs;
}

/** Employer name from the feed's "Custom RSS Feed for {name}" description. */
export function getSuccessFactorsFeedCompanyName(xml: string): string | null {
  const $ = cheerio.load(xml, { xml: true });
  const description = cleanText($("channel > description").first().text());
  const name = description.match(/^Custom RSS Feed for (.+)$/i)?.[1]?.trim();

  return name || null;
}

export function successFactorsCompanyName(feedName: string | null, url: URL): string {
  const host = getHostnameWithoutWww(url);
  return COMPANY_NAMES[host] ?? feedName ?? host;
}
