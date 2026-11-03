import * as cheerio from "cheerio";
import z from "zod";

import { RED_CROSS } from "@/constants/log";

import type { Company, Job } from "@/types";

import { Employer } from "../employer";

import { findIcimsIframeSrc, isIcimsUrl, normalizeIcimsUrl } from "@/modules/employer/shared/icims";
import {
  findJibeRedirect,
  getJibeApiUrl,
  getJibeJobLink,
  getJibeLocation,
  isJibeApiUrl,
  isJibeUrl,
  JIBE_PAGE_SIZE,
  jibeCompanyName,
  type JibeJob,
  parseJibeJobs,
} from "@/modules/employer/shared/jibe";
import { decodeHtmlEntities } from "@/utils/html";
import { fetchHtmlResponse } from "@/utils/http";
import { logger } from "@/utils/logger";
import { cleanText, formatCompanyName } from "@/utils/string";
import { getHostnameWithoutWww } from "@/utils/url";

export const IcimsJobSchema = z.object({
  title: z.string(),
  link: z.string(),
  location: z.string(),
  postedDate: z.string().optional(),
});

export type IcimsJob = z.infer<typeof IcimsJobSchema>;

const MAX_PAGES = 1;
const MAX_JIBE_PAGES = 20;

function getIcimsCompanyIdentifier(url: URL): string {
  const host = url.hostname;

  if (!host.endsWith(".icims.com")) return getHostnameWithoutWww(url);

  const careersMatch = host.match(/^careers-([^.]+)\.icims\.com$/);
  if (careersMatch?.[1]) return careersMatch[1];

  const brandedMatch = host.match(/www-([^-]+)-com\.i\.icims\.com$/);
  if (brandedMatch?.[1]) return brandedMatch[1];

  return host
    .replace(/\.i\.icims\.com$/, "")
    .replace(/\.icims\.com$/, "")
    .replace(/^careers-/, "");
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
  const { response, html } = await fetchHtmlResponse(url, {
    signal,
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/html",
    },
  });

  if (!response.ok) return null;

  return html;
}

async function resolveSearchPage(company: Company, signal: AbortSignal): Promise<string> {
  const url = new URL(company.page);

  if (isIcimsUrl(url, "search")) {
    return normalizeIcimsUrl(url.toString(), "search");
  }

  const html = await fetchHtml(company.page, signal);
  if (!html) return company.page;

  const iframeSrc = findIcimsIframeSrc(html, company.page, "search");

  if (iframeSrc) {
    return normalizeIcimsUrl(iframeSrc, "search");
  }

  return company.page;
}

function getIcimsJobsFromPage(html: string, pageUrl: URL): IcimsJob[] {
  const $ = cheerio.load(html);
  const jobs: IcimsJob[] = [];

  $("a[href*='/jobs/'][href*='/job']").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    const link = normalizeJobUrl(href, pageUrl);
    const id = getIcimsJobId(link);
    if (!id) return;

    const heading = $(el).find("h3").text();
    if (!heading) return;

    const title = cleanText(heading);
    if (!title) return;

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

    jobs.push({ title, link, location });
  });

  return jobs;
}

function toIcimsJob(origin: string, job: JibeJob): IcimsJob | null {
  const link = getJibeJobLink(origin, job);
  if (!link) return null;

  return {
    title: cleanText(job.title),
    link,
    location: getJibeLocation(job),
    postedDate: job.posted_date,
  };
}

/** Null when the response is not a Jibe listing. */
async function fetchJibeJobs(
  origin: string,
  page: number,
  signal: AbortSignal,
  limit = JIBE_PAGE_SIZE
): Promise<JibeJob[] | null> {
  const res = await fetch(getJibeApiUrl(origin, page, limit), {
    signal,
    headers: { Accept: "application/json" },
  });

  if (!res.ok) return null;

  try {
    return parseJibeJobs(await res.json());
  } catch {
    return null;
  }
}

/**
 * Newest first. With `probe`, a first page that is not Jibe yields nothing
 * instead of failing, for redirect targets that may be any career site.
 */
async function* listJibePages(
  origin: string,
  signal: AbortSignal,
  probe = false
): AsyncGenerator<IcimsJob[]> {
  for (let page = 1; page <= MAX_JIBE_PAGES; page++) {
    const jobs = await fetchJibeJobs(origin, page, signal);

    if (!jobs) {
      if (probe && page === 1) return;
      throw new Error(`Jibe listing failed: ${origin} page ${page}`);
    }

    yield jobs
      .map((job) => toIcimsJob(origin, job))
      .filter((job): job is IcimsJob => job !== null);

    if (jobs.length < JIBE_PAGE_SIZE) return;
  }
}

/** Throws when a page cannot be fetched so callers can tell failure from an empty board. */
async function* listIcimsPages(company: Company, signal: AbortSignal): AsyncGenerator<IcimsJob[]> {
  const page = new URL(company.page);

  if (isJibeApiUrl(page)) {
    yield* listJibePages(page.origin, signal);
    return;
  }

  const searchPage = await resolveSearchPage(company, signal);

  for (let pr = 0; pr < MAX_PAGES; pr++) {
    const pageUrl = new URL(searchPage);
    pageUrl.searchParams.set("pr", String(pr));

    const html = await fetchHtml(pageUrl.toString(), signal);
    if (html === null) throw new Error(`iCIMS listing failed: ${pageUrl}`);

    const jobs = getIcimsJobsFromPage(html, pageUrl);

    if (jobs.length === 0) {
      const jibe = pr === 0 ? findJibeRedirect(html, pageUrl) : null;
      if (jibe) yield* listJibePages(jibe.origin, signal, true);
      return;
    }

    yield jobs;
  }
}

async function fetchJibeCompanyName(origin: string): Promise<string | null> {
  try {
    const jobs = await fetchJibeJobs(origin, 1, AbortSignal.timeout(15_000), 1);
    return jobs?.[0]?.hiring_organization ?? null;
  } catch {
    return null;
  }
}

interface IcimsPageResponse {
  html: string;
  pageUrl: URL;
}

export class IcimsFetcher extends Employer<IcimsJob> {
  readonly ats = "icims" as const;

  companyKeyFromUrl(url: URL): string {
    return this.companyKey(getIcimsCompanyIdentifier(url));
  }

  async formCompany(url: URL): Promise<Company> {
    const identifier = getIcimsCompanyIdentifier(url);

    if (isJibeUrl(url) || isJibeApiUrl(url)) {
      return {
        name: jibeCompanyName(await fetchJibeCompanyName(url.origin), url) ?? identifier,
        ats: this.ats,
        identifier,
        domain: url.origin,
        page: new URL("/api/jobs", url.origin).toString(),
        urls: [],
      };
    }

    let page: string;

    if (isIcimsUrl(url, "search")) {
      page = normalizeIcimsUrl(url.toString(), "search");
    } else if (url.hostname.endsWith(".icims.com") && url.hostname.startsWith("careers-")) {
      page = `${url.origin}/jobs/search`;
    } else {
      page = url.toString();
    }

    return {
      name: identifier,
      ats: this.ats,
      identifier,
      domain: url.origin,
      page,
      urls: [],
    };
  }

  protected getJobsFromResponse(data: unknown): IcimsJob[] {
    if (
      !data ||
      typeof data !== "object" ||
      typeof (data as Partial<IcimsPageResponse>).html !== "string" ||
      !((data as Partial<IcimsPageResponse>).pageUrl instanceof URL)
    ) {
      return [];
    }

    const { html, pageUrl } = data as IcimsPageResponse;
    return getIcimsJobsFromPage(html, pageUrl);
  }

  protected getJobLink(job: IcimsJob, company: Company): string {
    void company;
    return job.link;
  }

  protected normalizeJob(job: IcimsJob, company: Company): Job {
    return {
      company: formatCompanyName(company.name),
      role: job.title,
      link: this.getJobLink(job, company),
      location: job.location,
    };
  }

  protected async collectListingJobs(
    company: Company,
    signal: AbortSignal
  ): Promise<IcimsJob[] | null> {
    const jobs: IcimsJob[] = [];

    try {
      for await (const page of listIcimsPages(company, signal)) {
        jobs.push(...page);
      }

      return jobs;
    } catch {
      return jobs.length > 0 ? jobs : null;
    }
  }

  async fetch(
    company: Company,
    knownKeys: ReadonlySet<string>,
    signal: AbortSignal
  ): Promise<Job[]> {
    const allJobs: Job[] = [];

    // Keep pagination deduplication local so the caller's key set stays immutable.
    const seenKeys = new Set(knownKeys);

    try {
      for await (const page of listIcimsPages(company, signal)) {
        // Jibe pages are newest first, so one stale job means the rest are stale too.
        let reachedOldJob = false;

        const opportunities = page
          .map((job) => this.posting(job, company, job.postedDate))
          .filter((posting, index) => {
            if (page[index].postedDate && !posting.isRecent()) {
              reachedOldJob = true;
              return false;
            }

            if (!posting.isTarget() || posting.isKnown(seenKeys)) return false;
            seenKeys.add(posting.key());
            return true;
          })
          .map((posting) => posting.toJob());

        allJobs.push(...opportunities);

        if (reachedOldJob) break;
      }
    } catch {
      logger.error({ url: company.page }, `${RED_CROSS} Error fetching icims jobs`);
      return [];
    }

    return allJobs;
  }
}

export const icimsFetcher = new IcimsFetcher();
