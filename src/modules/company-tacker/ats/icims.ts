import * as cheerio from "cheerio";

import { ABORT_SIGNAL } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { Company } from "@/modules/company-tacker/type";
import type { Job } from "@/types";

import { isTarget } from "../utils";

import { logger } from "@/utils/logger";
import { capitalize } from "@/utils/string";

const MAX_PAGES = 1;

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function getIcimsCompanyIdentifier(url: URL): string {
  const host = url.hostname;

  const careersMatch = host.match(/^careers-([^.]+)\.icims\.com$/);
  if (careersMatch?.[1]) return careersMatch[1];

  const brandedMatch = host.match(/www-([^-]+)-com\.i\.icims\.com$/);
  if (brandedMatch?.[1]) return brandedMatch[1];

  return host
    .replace(/\.i\.icims\.com$/, "")
    .replace(/\.icims\.com$/, "")
    .replace(/^careers-/, "");
}

function isIcimsSearchUrl(url: URL): boolean {
  return url.hostname.endsWith(".icims.com") && url.pathname === "/jobs/search";
}

function toIcimsSearchUrl(url: URL): string {
  const searchUrl = new URL(url.toString());

  searchUrl.pathname = "/jobs/search";
  searchUrl.searchParams.set("in_iframe", "1");

  return searchUrl.toString();
}

export function urlToIcimsCompany(url: URL): Company {
  const identifier = getIcimsCompanyIdentifier(url);

  let page: string;

  if (isIcimsSearchUrl(url)) {
    page = toIcimsSearchUrl(url);
  } else if (url.hostname.endsWith(".icims.com") && url.hostname.startsWith("careers-")) {
    page = `${url.origin}/jobs/search`;
  } else {
    page = url.toString();
  }

  return {
    name: identifier,
    ats: "icims",
    identifier,
    domain: url.origin,
    page,
    urls: [],
  };
}

function findIcimsIframeSrc(html: string, baseUrl: string): string | null {
  const $ = cheerio.load(html);

  // 1. iframe with normal src
  const normalSrc =
    $("iframe[src*='icims.com/jobs/search']").attr("src") ??
    $("iframe[src*='/jobs/search']").attr("src");

  if (normalSrc) {
    return new URL(decodeHtmlEntities(normalSrc), baseUrl).toString();
  }

  // 2. iframe with noscript src
  for (const el of $("noscript").toArray()) {
    const noscriptHtml = $(el).html() ?? $(el).text();
    if (!noscriptHtml) continue;

    const $$ = cheerio.load(noscriptHtml);

    const src =
      $$("iframe[src*='icims.com/jobs/search']").attr("src") ??
      $$("iframe[src*='/jobs/search']").attr("src");

    if (src) {
      return new URL(decodeHtmlEntities(src), baseUrl).toString();
    }
  }

  // 3. fallback: iframe with raw src
  const iframeMatch = html.match(
    /<iframe[^>]+src=["']([^"']*(?:icims\.com\/jobs\/search|\/jobs\/search)[^"']*)["']/i
  );

  if (iframeMatch?.[1]) {
    return new URL(decodeHtmlEntities(iframeMatch[1]), baseUrl).toString();
  }

  // 4. fallback: iframe with raw url in JS string
  const rawUrlMatch = html.match(/https?:\/\/[^"'<>\s]+\.icims\.com\/jobs\/search[^"'<>\s]*/i);

  if (rawUrlMatch?.[0]) {
    return decodeHtmlEntities(rawUrlMatch[0]);
  }

  return null;
}

function getIcimsJobId(url: string): string | null {
  const match = url.match(/\/jobs\/(\d+)\//);
  return match?.[1] ?? null;
}

function normalizeJobUrl(href: string, baseUrl: URL): string {
  const url = new URL(decodeHtmlEntities(href), baseUrl);

  url.searchParams.delete("in_iframe");
  url.searchParams.delete("mobile");
  url.searchParams.delete("width");
  url.searchParams.delete("height");
  url.searchParams.delete("bga");
  url.searchParams.delete("needsRedirect");
  url.searchParams.delete("jan1offset");
  url.searchParams.delete("jun1offset");

  return url.toString();
}

function getLocationFromCard(cardText: string): string {
  const locationMatch = cardText.match(/\b[A-Z]{2}-[A-Z]{2}-[A-Za-z0-9 .,'/-]+/);
  if (locationMatch?.[0]) return locationMatch[0].trim();

  return "Unsure";
}

async function fetchHtml(url: string, signal: AbortSignal): Promise<string | null> {
  const res = await fetch(url, {
    signal,
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/html",
    },
  });

  if (!res.ok) return null;

  return res.text();
}

async function resolveSearchPage(company: Company, signal: AbortSignal): Promise<string> {
  const url = new URL(company.page);

  if (isIcimsSearchUrl(url)) {
    url.searchParams.set("in_iframe", "1");
    return url.toString();
  }

  const html = await fetchHtml(company.page, signal);
  if (!html) return company.page;

  const iframeSrc = findIcimsIframeSrc(html, company.page);

  if (iframeSrc) {
    const iframeUrl = new URL(iframeSrc);
    iframeUrl.searchParams.set("in_iframe", "1");
    return iframeUrl.toString();
  }

  return company.page;
}

function extractJobsFromSearchHtml(
  html: string,
  pageUrl: URL,
  company: Company,
  seenUrls: Set<string>
): Job[] {
  const $ = cheerio.load(html);
  const jobs: Job[] = [];

  $("a[href*='/jobs/'][href*='/job']").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    const link = normalizeJobUrl(href, pageUrl);
    const id = getIcimsJobId(link);
    if (!id) return;

    if (seenUrls.has(link)) return;

    // grep heading
    const heading = $(el).find("h3").text();
    if (!heading) return;

    const role = cleanText(heading);
    if (!role) return;

    const card = $(el).closest(
      [
        ".iCIMS_JobsTable",
        ".iCIMS_JobContent",
        ".iCIMS_JobHeader",
        ".row",
        "article",
        "li",
        "div",
      ].join(", ")
    );

    const cardText = cleanText(card.text());
    const location = getLocationFromCard(cardText);

    const job: Job = {
      company: capitalize(company.name),
      role,
      link,
      location,
    };

    seenUrls.add(link);
    jobs.push(job);
  });

  return jobs;
}

export async function fetchIcims(
  company: Company,
  urls: Set<string>,
  signal: AbortSignal = ABORT_SIGNAL
): Promise<Job[]> {
  const allJobs: Job[] = [];

  // Important:
  // Use a local Set for deduping inside this fetcher.
  // Do not mutate the caller's urls Set, because the outer layer may use it
  // after fetchIcims returns to decide which jobs are new.
  const seenUrls = new Set(urls);

  try {
    const searchPage = await resolveSearchPage(company, signal);

    for (let page = 0; page < MAX_PAGES; page++) {
      const pageUrl = new URL(searchPage);

      pageUrl.searchParams.set("pr", String(page));

      const html = await fetchHtml(pageUrl.toString(), signal);
      if (!html) break;

      const pageJobs = extractJobsFromSearchHtml(html, pageUrl, company, seenUrls);

      if (pageJobs.length === 0) break;

      allJobs.push(...pageJobs);
    }
  } catch {
    logger.error({ url: company.page }, `${RED_CROSS} Error fetching icims jobs`);
    return [];
  }

  return allJobs.filter((job) => isTarget(job.role));
}
