import * as cheerio from "cheerio";
import z from "zod";

import { ABORT_SIGNAL } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { Company } from "../../type";
import type { Job } from "@/types";

import { isTarget, withinDays } from "../../utils";

import { logger } from "@/utils/logger";
import { cleanText } from "@/utils/string";

const APPLE_CAREERS_URL = "https://jobs.apple.com/en-us/search";

export const AppleCompany = {
  name: "Apple",
  ats: "custom",
  identifier: "apple",
  domain: "https://jobs.apple.com",
  page: APPLE_CAREERS_URL,
  urls: [],
} as const satisfies Company;

export const AppleJobSchema = z.object({
  title: z.string(),
  link: z.string(),
  location: z.string().nullable(),
  postedAt: z.string().nullable(),
});

export type AppleJob = z.infer<typeof AppleJobSchema>;

const MAX_PAGES = 20;

export function parseAppleJobs(html: string): AppleJob[] {
  const $ = cheerio.load(html);
  const jobs: AppleJob[] = [];

  $("#search-job-list > li").each((_, li) => {
    const card = $(li);

    const link = card
      .find("a[href*='/en-us/details/']")
      .filter((_, a) => {
        const text = cleanText($(a).text());
        return text.length > 0 && !/see full role description/i.test(text);
      })
      .first();

    const title = cleanText(link.text());
    const href = link.attr("href");

    if (!title || !href) {
      return;
    }

    const location =
      cleanText(card.find(".table--advanced-search__location-sub").first().text()) || null;

    const postedAt = cleanText(card.find(".job-posted-date").first().text()) || null;

    if (withinDays(postedAt ?? "", 2)) {
      jobs.push({
        title,
        link: new URL(href, APPLE_CAREERS_URL).toString(),
        location,
        postedAt,
      });
    }
  });

  return jobs;
}

async function fetchAppleHtml(urlStr: string, page: number = 1, signal: AbortSignal) {
  const url = new URL(urlStr);
  url.searchParams.set("sort", "newest");
  url.searchParams.set("page", String(page));

  const res = await fetch(url, {
    signal,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!res.ok) {
    logger.error(
      { company: "Apple", url: url.toString() },
      `${RED_CROSS} Apple jobs fetch failed: ${res.status} ${res.statusText}`
    );
    return "";
  }

  return res.text();
}

function normalizeAppleJob(job: AppleJob): Job {
  return {
    company: "Apple",
    role: job.title,
    link: job.link,
    location: job.location ?? "",
  };
}

export async function fetchApple(
  company: Company,
  urls: Set<string>,
  signal: AbortSignal = ABORT_SIGNAL
): Promise<Job[]> {
  try {
    const jobs: Job[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const html = await fetchAppleHtml(company.page, page, signal);

      if (html === "") {
        break;
      }

      const rawJobs = parseAppleJobs(html);

      if (rawJobs.length === 0) {
        break;
      }

      const opportunities = rawJobs
        .filter((job) => isTarget(job.title) && !urls.has(job.link))
        .map(normalizeAppleJob);

      jobs.push(...opportunities);
    }

    return jobs;
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      logger.error(
        { err: "TimeoutError", company: company.name, url: company.page },
        `${RED_CROSS} Error fetching apple jobs`
      );

      return [];
    }

    logger.error({ err: error, company: company.name }, `${RED_CROSS} Error fetching apple jobs`);

    return [];
  }
}
