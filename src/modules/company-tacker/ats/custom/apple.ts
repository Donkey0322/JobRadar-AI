import * as cheerio from "cheerio";

import { APPLE_CAREERS_URL } from "@/constants/ats";
import { RED_CROSS } from "@/constants/log";

import type { Company } from "../../type";
import type { Job } from "@/types";

import { isTarget } from "../../utils";

import { logger } from "@/utils/logger";
import { capitalize, getToday } from "@/utils/string";

export interface AppleJob {
  title: string;
  link: string;
  location: string | null;
  postedAt: string | null;
}

const MAX_PAGES = 20;

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function parseAppleJobs(html: string): AppleJob[] {
  const $ = cheerio.load(html);
  const jobs: AppleJob[] = [];

  $("#search-job-list > li").each((_, li) => {
    const card = $(li);

    const link = card
      .find("a[href*='/en-us/details/']")
      .filter((_, a) => {
        const text = normalizeText($(a).text());
        return text.length > 0 && !/see full role description/i.test(text);
      })
      .first();

    const title = normalizeText(link.text());
    const href = link.attr("href");

    if (!title || !href) {
      return;
    }

    const location =
      normalizeText(card.find(".table--advanced-search__location-sub").first().text()) || null;

    const postedAt = normalizeText(card.find(".job-posted-date").first().text()) || null;
    const postedAtDate = new Date(postedAt ?? "");
    const currentDate = new Date(getToday());
    const difference = currentDate.getTime() - postedAtDate.getTime();
    const differenceDays = Math.ceil(difference / (1000 * 60 * 60 * 24));

    if (differenceDays <= 3) {
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

export async function fetchApple(
  company: Company,
  urls: Set<string>,
  signal: AbortSignal
): Promise<Job[]> {
  try {
    const allJobs: AppleJob[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const html = await fetchAppleHtml(company.page, page, signal);
      if (html === "") {
        break;
      }
      const jobs = parseAppleJobs(html);

      if (jobs.length === 0) {
        break;
      }
      allJobs.push(...jobs);
    }

    const jobs = allJobs.filter((job) => isTarget(job.title) && !urls.has(job.link));
    return jobs.map((job) => ({
      company: capitalize(company.name),
      role: job.title,
      link: job.link,
      location: job.location ?? "",
    }));
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
