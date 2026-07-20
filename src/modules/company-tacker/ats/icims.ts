import * as cheerio from "cheerio";
import z from "zod";

import { RED_CROSS } from "@/constants/log";

import type { Company } from "@/modules/company-tacker/type";
import type { Job } from "@/types";

import { isTarget } from "../utils";

import { ATSFetcher } from "./class";

import { findIcimsIframeSrc, isIcimsUrl, normalizeIcimsUrl } from "@/modules/shared/ats/icims";
import { decodeHtmlEntities } from "@/utils/html";
import { fetchHtmlResponse } from "@/utils/http";
import { logger } from "@/utils/logger";
import { capitalize, cleanText } from "@/utils/string";

export const IcimsJobSchema = z.object({
  title: z.string(),
  link: z.string(),
  location: z.string(),
});

export type IcimsJob = z.infer<typeof IcimsJobSchema>;

const MAX_PAGES = 1;

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

interface IcimsPageResponse {
  html: string;
  pageUrl: URL;
}

export class IcimsFetcher extends ATSFetcher<IcimsJob> {
  readonly ats = "icims" as const;

  formCompany(url: URL): Company {
    const identifier = getIcimsCompanyIdentifier(url);

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
      company: capitalize(company.name),
      role: job.title,
      link: this.getJobLink(job, company),
      location: job.location,
    };
  }

  async fetch(company: Company, urls: Set<string>, signal: AbortSignal): Promise<Job[]> {
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

        const rawJobs = this.getJobsFromResponse({ html, pageUrl });

        if (rawJobs.length === 0) break;

        const opportunities = rawJobs
          .filter((job) => {
            const link = this.getJobLink(job, company);
            if (!isTarget(job.title) || seenUrls.has(link)) return false;
            seenUrls.add(link);
            return true;
          })
          .map((job) => this.normalizeJob(job, company));

        allJobs.push(...opportunities);
      }
    } catch {
      logger.error({ url: company.page }, `${RED_CROSS} Error fetching icims jobs`);
      return [];
    }

    return allJobs;
  }
}

export const icimsFetcher = new IcimsFetcher();
