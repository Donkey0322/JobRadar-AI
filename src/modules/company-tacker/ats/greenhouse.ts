import * as cheerio from "cheerio";
import z from "zod";

import { GREENHOUSE_API_URL } from "@/constants/ats";
import { RED_CROSS } from "@/constants/log";

import type { Company } from "../type";
import type { Job } from "@/types";

import { isTarget, withinDays } from "../utils";

import { ATSFetcher } from "./class";

import { appendErrorLog } from "@/utils/data";
import { logger } from "@/utils/logger";
import { getHostnameWithoutWww, getSubdomainIdentifier } from "@/utils/url";

const identifierMap: Record<string, string> = {
  "mlb.com": "majorleaguebaseball",
  "digitalocean.com": "digitalocean98",
  "dltrading.io": "confidentialsportstradingfirm",
  "pinterestcareers.com": "pinterest",
  "rentptr.com": "premiertruckrental",
  "zipline.com": "flyzipline",
  "squarepoint-capital.com": "squarepointcapital",
  "corporate.trustpilot.com": "trustpilot",
  "c3.ai": "c3iot",
  "solarwinds.com": "solarwinds",
  "8am.com": "affinipay1",
  "cra.com": "charlesriveranalytics90",
  "precisely.com": "preciselyusjobs",
  "tower-research.com": "towerresearchcapital",

  // careerpuck.com
  "domino-data-lab": "dominodatalab",
};

function isGreenhouseJobBoardHost(host: string) {
  return (
    host === "boards.greenhouse.io" ||
    host === "job-boards.greenhouse.io" ||
    (host.endsWith(".greenhouse.io") &&
      (host.startsWith("boards.") || host.startsWith("job-boards.")))
  );
}

export const GreenhouseJobSchema = z.object({
  company_name: z.string().optional(),
  title: z.string(),
  absolute_url: z.string(),
  first_published: z.string().nullish(),
  updated_at: z.string(),
  location: z.object({ name: z.string() }).optional(),
});

export type GreenhouseJob = z.infer<typeof GreenhouseJobSchema>;

export const GreenhouseResponseSchema = z.object({
  jobs: z.array(GreenhouseJobSchema),
});

export class GreenhouseFetcher extends ATSFetcher<GreenhouseJob> {
  readonly ats = "greenhouse" as const;

  async formCompany(url: URL): Promise<Company> {
    const parts = url.pathname.split("/").filter(Boolean);
    const host = getHostnameWithoutWww(url);

    // Case 0:
    if (identifierMap[host]) {
      return this.buildCompany(url, identifierMap[host]);
    }

    // Case 1:
    // https://boards.greenhouse.io/embed/job_board?for=xxx
    // https://boards.greenhouse.io/embed/job_board/js?for=xxx
    // https://boards.eu.greenhouse.io/embed/job_board?for=xxx
    // https://boards.greenhouse.io/embed/job_app?token=xxx
    if (isGreenhouseJobBoardHost(host) && parts[0] === "embed") {
      let identifier = url.searchParams.get("for");

      if (!identifier && parts[1] === "job_app") {
        try {
          const response = await fetch(url.href);
          identifier = new URL(response.url).searchParams.get("for") ?? null;
        } catch {
          identifier = null;
        }
      }

      return this.buildCompany(url, identifier || getSubdomainIdentifier(url));
    }

    // Case 2:
    // https://job-boards.greenhouse.io/acluinternships/jobs/8425459002
    // https://job-boards.eu.greenhouse.io/imc/jobs/4580809101
    // https://boards.greenhouse.io/acluinternships
    if (isGreenhouseJobBoardHost(host)) {
      return this.buildCompany(url, parts[0] || getSubdomainIdentifier(url));
    }

    // Case 3:
    // https://app.careerpuck.com/job-board/lyft/job/8215921002?gh_jid=8215921002
    if (host === "app.careerpuck.com") {
      const jobBoardIndex = parts.indexOf("job-board");
      const companySlug = parts[jobBoardIndex + 1];

      if (companySlug) {
        return this.buildCompany(url, identifierMap[companySlug] || companySlug);
      }
    }

    // Case 4:
    // https://www.acadian-asset.com/careers/open-positions?gh_jid=4645552006
    const embeddedIdentifier = await this.findEmbeddedIdentifier(url);
    if (embeddedIdentifier) {
      return this.buildCompany(url, embeddedIdentifier);
    }

    // Case 5:
    // fallback: keep old behavior, never return empty identifier
    const identifier = getSubdomainIdentifier(url);

    return this.buildCompany(url, identifier);
  }

  protected getJobsFromResponse(data: unknown): GreenhouseJob[] {
    const parsed = GreenhouseResponseSchema.safeParse(data);

    if (!parsed.success) {
      logger.error(
        { data, issues: parsed.error.issues },
        `${RED_CROSS} Invalid Greenhouse response`
      );
      return [];
    }

    return parsed.data.jobs;
  }

  protected getJobLink(job: GreenhouseJob, _company: Company): string {
    void _company;
    return job.absolute_url;
  }

  protected normalizeJob(job: GreenhouseJob, company: Company): Job {
    return {
      company: job.company_name || company.name,
      role: job.title,
      link: this.getJobLink(job, company),
      location: job.location?.name ?? "",
    };
  }

  async fetch(company: Company, urls: Set<string>, signal: AbortSignal): Promise<Job[]> {
    try {
      const response = await fetch(company.page, { signal });

      if (!response.ok) {
        await appendErrorLog(
          `Greenhouse: ${company.name} - ${response.status} - ${response.statusText}`
        );
        return [];
      }

      return this.getJobsFromResponse(await response.json())
        .filter((job) => {
          const link = this.getJobLink(job, company);
          return (
            isTarget(job.title) &&
            !urls.has(link) &&
            (withinDays(job.first_published) || withinDays(job.updated_at))
          );
        })
        .map((job) => this.normalizeJob(job, company));
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        logger.warn(
          {
            company: company.name,
            url: company.page,
          },
          "⚠️ Greenhouse request aborted"
        );
        return [];
      }

      logger.error(
        {
          error,
          company: company.name,
          url: company.page,
        },
        `${RED_CROSS} Error fetching greenhouse jobs`
      );
      return [];
    }
  }

  private buildCompany(url: URL, identifier: string): Company {
    return {
      name: identifier,
      ats: this.ats,
      identifier,
      domain: url.origin,
      page: `${GREENHOUSE_API_URL}/${identifier}/jobs`,
      urls: [],
    };
  }

  private async findEmbeddedIdentifier(url: URL): Promise<string | null> {
    try {
      const response = await fetch(url.href, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        },
      });

      if (!response.ok) return null;

      const html = await response.text();
      const $ = cheerio.load(html);
      const embedSrc = $("script[src*='greenhouse.io'], iframe[src*='greenhouse.io']")
        .first()
        .attr("src");

      if (embedSrc) {
        const embedUrl = new URL(embedSrc, url.href);
        const identifier = embedUrl.searchParams.get("for");
        if (identifier) return identifier;

        const parts = embedUrl.pathname.split("/").filter(Boolean);
        if (
          isGreenhouseJobBoardHost(getHostnameWithoutWww(embedUrl)) &&
          parts[0] &&
          parts[0] !== "embed"
        ) {
          return parts[0];
        }
      }

      const match = html.match(
        /(?:boards|job-boards)(?:\.[a-z]+)?\.greenhouse\.io\/embed\/job_board\/(?:js)?\?for=([^"'&\s]+)/i
      );
      return match?.[1] ?? null;
    } catch {
      return null;
    }
  }
}

export const greenhouseFetcher = new GreenhouseFetcher();

/**
 * {
    "name": "sofi",
    "ats": "greenhouse",
    "identifier": "sofi",
    "domain": "https://sofi.com",
    "page": "https://boards-api.greenhouse.io/v1/boards/sofi/jobs",
    "urls": [
      "https://sofi.com/careers/job/7565483003?gh_jid=7565483003"
    ]
  },
  {
    "name": "sofiuniversity",
    "ats": "greenhouse",
    "identifier": "sofiuniversity",
    "domain": "https://www.sofi.com",
    "page": "https://boards-api.greenhouse.io/v1/boards/sofiuniversity/jobs",
    "urls": [
      "https://www.sofi.com/careers/sofi-university/7581448003?gh_jid=7581448003",
      "https://www.sofi.com/careers/sofi-university/7581753003?gh_jid=7581753003",
      "https://www.sofi.com/careers/sofi-university/7585152003?gh_jid=7585152003",
      "https://www.sofi.com/careers/sofi-university/7595648003?gh_jid=7595648003",
      "https://www.sofi.com/careers/sofi-university/7600784003?gh_jid=7600784003",
      "https://www.sofi.com/careers/sofi-university/7616239003?gh_jid=7616239003",
      "https://www.sofi.com/careers/sofi-university/7637277003?gh_jid=7637277003",
      "https://www.sofi.com/careers/sofi-university/?gh_jid=7575833003&gh_src=d50e8f9b3us"
    ]
  },
 */
