import * as cheerio from "cheerio";

import { decodeHtmlEntities } from "@/utils/html";
import { cleanText } from "@/utils/string";

const LOCALE_PREFIX = "^(?:/([a-z]{2}(?:-[a-z]{2})?))?";
const RADANCY_JOB_PATH = new RegExp(`${LOCALE_PREFIX}/job/[^/]+/[^/]+/\\d+/\\d+/?$`, "i");
const RADANCY_SEARCH_PATH = new RegExp(
  `${LOCALE_PREFIX}/search-jobs(?:/results(?:post)?)?/?$`,
  "i"
);

export interface RadancyJob {
  jobId: string;
  title: string;
  link: string;
  location: string;
}

export function isRadancyJobUrl(url: URL): boolean {
  return RADANCY_JOB_PATH.test(url.pathname);
}

export function isRadancySearchUrl(url: URL): boolean {
  return RADANCY_SEARCH_PATH.test(url.pathname);
}

export function isRadancyUrl(url: URL): boolean {
  return isRadancyJobUrl(url) || isRadancySearchUrl(url);
}

export function isRadancyHtml(html: string): boolean {
  return (
    /tbcdn\.talentbrew\.com/i.test(html) ||
    /search-jobs\/resultspost/i.test(html) ||
    (/data-ajax-post-url=/i.test(html) && /search-jobs/i.test(html))
  );
}

export function getRadancyLocalePrefix(url: URL): string {
  const match = url.pathname.match(RADANCY_JOB_PATH) ?? url.pathname.match(RADANCY_SEARCH_PATH);
  const locale = match?.[1];

  return locale ? `/${locale.toLowerCase()}` : "";
}

export function getRadancyJobId(url: URL): string | null {
  const match = url.pathname.match(/\/job\/[^/]+\/[^/]+\/\d+\/(\d+)\/?$/i);
  return match?.[1] ?? null;
}

export function getRadancyResultsPostUrl(url: URL): string {
  const locale = getRadancyLocalePrefix(url);
  return `${url.origin}${locale}/search-jobs/resultspost`;
}

export function parseRadancyJobs(html: string, baseUrl: string): RadancyJob[] {
  const $ = cheerio.load(html);
  const jobs: RadancyJob[] = [];
  const seen = new Set<string>();

  $("a[data-job-id][href*='/job/']").each((_, el) => {
    const href = $(el).attr("href");
    const jobId = $(el).attr("data-job-id")?.trim();
    if (!href || !jobId || seen.has(jobId)) return;

    let link: string;

    try {
      link = new URL(decodeHtmlEntities(href), baseUrl).toString();
    } catch {
      return;
    }

    const heading = cleanText($(el).find("h3").first().text());
    const title = heading || cleanText($(el).text());
    if (!title) return;

    const card = $(el).closest("li, article, .job-card, .sr-job-item");
    const location = cleanText(
      card
        .find(".location, .job-location, .sr-job-location, [class*='job-location']")
        .first()
        .text()
    );

    seen.add(jobId);
    jobs.push({
      jobId,
      title,
      link,
      location,
    });
  });

  return jobs;
}
