import * as cheerio from "cheerio";
import z from "zod";

import { ABORT_SIGNAL } from "@/constants";

import type { Company } from "@/modules/company-tacker/type";
import type { Job } from "@/types";

import { isTarget } from "../../utils";

const GOOGLE_CAREERS_URL = "https://www.google.com/about/careers/applications";

export const GoogleCompany = {
  name: "Google",
  ats: "custom",
  identifier: "google",
  domain: "https://www.google.com",
  page: `${GOOGLE_CAREERS_URL}/jobs/results`,
  urls: [],
} as const satisfies Company;

export const GoogleJobSchema = z.object({
  role: z.string(),
  company: z.string(),
  location: z.string(),
  link: z.string(),
});

type GoogleJob = z.infer<typeof GoogleJobSchema>;

function getGoogleJobsFromPage(html: string): GoogleJob[] {
  const $ = cheerio.load(html);

  return $("a[href*='jobs/results/']")
    .map((_, el) => {
      const link = $(el).attr("href");
      if (!link) return null;

      let card = $(el).parent();

      while (card.length && card.find("h3").length === 0) {
        card = card.parent();
      }

      if (!card.length) return null;

      const role = card.find("h3").first().text().trim();

      const metaLine = card
        .find("p")
        .filter((_, p) => $(p).text().includes("|"))
        .first()
        .text()
        .trim();

      let jobCompany = "";
      let location = "";

      if (metaLine.includes("|")) {
        const parts = metaLine.split("|");
        jobCompany = parts[0].trim();
        location = parts.slice(1).join("|").trim();
      }

      return {
        role,
        company: jobCompany,
        location,
        link: `${GOOGLE_CAREERS_URL}/${link}`,
      };
    })
    .get()
    .filter(Boolean) as GoogleJob[];
}

function normalizeGoogleJob(job: GoogleJob): Job {
  return {
    company: job.company,
    role: job.role,
    link: job.link,
    location: job.location,
  };
}

export async function fetchGoogle(
  company: Company,
  urls: Set<string>,
  signal: AbortSignal = ABORT_SIGNAL
): Promise<Job[]> {
  const jobs: Job[] = [];

  for (let page = 1; page <= 20; page++) {
    const url = new URL(company.page);
    url.searchParams.set("sort_by", "date");
    url.searchParams.set("page", String(page));

    const res = await fetch(url.toString(), {
      signal,
    });

    if (!res.ok) {
      break;
    }

    const rawJobs = getGoogleJobsFromPage(await res.text());

    if (rawJobs.length === 0) {
      break;
    }

    const opportunities = rawJobs
      .filter((job) => isTarget(job.role) && !urls.has(job.link))
      .map(normalizeGoogleJob);

    jobs.push(...opportunities);
  }

  return jobs;
}
