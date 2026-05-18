import * as cheerio from "cheerio";

import type { Company } from "@/modules/company-tacker/type";
import type { Job } from "@/types";

import { isTarget } from "../../utils";

export async function fetchGoogle(companyData: Company, urls: Set<string>): Promise<Job[]> {
  const allJobs: Job[] = [];

  for (let page = 1; page <= 10; page++) {
    const url = new URL(companyData.page);
    url.searchParams.set("page", String(page));

    const res = await fetch(url.toString());

    if (!res.ok) {
      break;
    }

    const html = await res.text();

    const $ = cheerio.load(html);

    const pageJobs = $("a[href*='jobs/results/']")
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

        let company = "";
        let location = "";

        if (metaLine.includes("|")) {
          const parts = metaLine.split("|");
          company = parts[0].trim();
          location = parts.slice(1).join("|").trim();
        }

        return {
          role,
          company,
          location,
          link: "https://www.google.com/about/careers/applications/" + link,
        };
      })
      .get()
      .filter(Boolean);

    if (pageJobs.length === 0) {
      break;
    }

    allJobs.push(...pageJobs);
  }

  const jobs = allJobs.filter((job) => isTarget(job.role) && !urls.has(job.link));
  return jobs;
}
