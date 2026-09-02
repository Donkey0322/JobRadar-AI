import * as cheerio from "cheerio";
import z from "zod";

import { GREENHOUSE_API_URL } from "@/constants/ats";
import { RED_CROSS } from "@/constants/log";

import type { Company, Job } from "@/types";

import { ATSFetcher } from "../core/fetcher";
import { isTarget, withinDays } from "../core/filter";

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
  "careers.airbnb.com": "airbnb",
  "careers.dat.com": "datsolutions",
  "boomi.com": "boomilp",
  "airbnb.com": "airbnb",
  "verition.com": "veritiongroupllc",

  // careerpuck.com
  "domino-data-lab": "dominodatalab",
};

function mappedIdentifier(host: string): string | undefined {
  const exact = identifierMap[host];
  if (exact) return exact;

  for (const [domain, identifier] of Object.entries(identifierMap)) {
    if (domain.includes(".") && host.endsWith(`.${domain}`)) {
      return identifier;
    }
  }
}

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
  location: z.object({ name: z.string().nullish() }).optional(),
});

export type GreenhouseJob = z.infer<typeof GreenhouseJobSchema>;

export const GreenhouseResponseSchema = z.object({
  jobs: z.array(GreenhouseJobSchema),
});

export class GreenhouseFetcher extends ATSFetcher<GreenhouseJob> {
  readonly ats = "greenhouse" as const;

  companyKeyFromUrl(url: URL): string {
    const syncIdentifier = this.getSyncIdentifier(url);

    if (syncIdentifier) {
      return this.companyKey(syncIdentifier);
    }

    const parts = url.pathname.split("/").filter(Boolean);
    const host = getHostnameWithoutWww(url);

    // Provisional keys for URLs that need network to resolve the real identifier
    if (isGreenhouseJobBoardHost(host) && parts[0] === "embed" && parts[1] === "job_app") {
      const token = url.searchParams.get("token");
      return this.companyKey(token ? `job_app:${token}` : `url:${url.href}`);
    }

    return this.companyKey(`host:${host}`);
  }

  async formCompany(url: URL): Promise<Company> {
    const syncIdentifier = this.getSyncIdentifier(url);

    if (syncIdentifier) {
      return this.buildCompany(url, syncIdentifier);
    }

    // Case 1 (partial): embed job_app without `for=` needs a redirect to resolve
    const parts = url.pathname.split("/").filter(Boolean);
    const host = getHostnameWithoutWww(url);

    if (isGreenhouseJobBoardHost(host) && parts[0] === "embed" && parts[1] === "job_app") {
      try {
        const response = await fetch(url.href);
        const identifier = new URL(response.url).searchParams.get("for");
        return this.buildCompany(url, identifier || getSubdomainIdentifier(url));
      } catch {
        return this.buildCompany(url, getSubdomainIdentifier(url));
      }
    }

    // Case 4: scrape embedded Greenhouse identifier from careers HTML
    const embeddedIdentifier = await this.findEmbeddedIdentifier(url);
    if (embeddedIdentifier) {
      return this.buildCompany(url, embeddedIdentifier);
    }

    // Case 5: fallback
    return this.buildCompany(url, getSubdomainIdentifier(url));
  }

  /**
   * Identifier known from the URL alone (no network).
   * Returns null when HTML scrape / redirect is required.
   */
  private getSyncIdentifier(url: URL): string | null {
    const parts = url.pathname.split("/").filter(Boolean);
    const host = getHostnameWithoutWww(url);

    // Case 0: exact host or subdomain of a mapped domain (jobs.solarwinds.com → solarwinds.com)
    const mapped = mappedIdentifier(host);
    if (mapped) {
      return mapped;
    }

    // Case 1: embed with explicit `for=`
    if (isGreenhouseJobBoardHost(host) && parts[0] === "embed") {
      const forParam = url.searchParams.get("for");
      if (forParam) {
        return forParam;
      }

      // job_app without `for=` needs network
      if (parts[1] === "job_app") {
        return null;
      }

      return getSubdomainIdentifier(url);
    }

    // Case 2: greenhouse job board hosts
    if (isGreenhouseJobBoardHost(host)) {
      return parts[0] || getSubdomainIdentifier(url);
    }

    // Case 3: careerpuck
    if (host === "app.careerpuck.com") {
      const jobBoardIndex = parts.indexOf("job-board");
      const companySlug = parts[jobBoardIndex + 1];

      if (companySlug) {
        return identifierMap[companySlug] || companySlug;
      }
    }

    return null;
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
      company: job.company_name ?? company.name,
      role: job.title,
      link: this.getJobLink(job, company),
      location: job.location?.name ?? "",
    };
  }

  async fetch(
    company: Company,
    knownKeys: ReadonlySet<string>,
    signal: AbortSignal
  ): Promise<Job[]> {
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
            !this.isKnownJob(link, knownKeys) &&
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
