import * as cheerio from "cheerio";
import z from "zod";

import { ASHBY_API_URL } from "@/constants/ats";
import { RED_CROSS } from "@/constants/log";

import type { Company, Job } from "@/types";

import { ATSFetcher } from "../core/fetcher";
import { isTarget, withinDays } from "../core/filter";

import { appendErrorLog } from "@/utils/data";
import { logger } from "@/utils/logger";
import { capitalize } from "@/utils/string";
import { getHostnameWithoutWww, getSubdomainIdentifier } from "@/utils/url";

const identifierMap: Record<string, string> = {
  "superhuman.com": "Superhuman%20Platform%20Inc",
};

const ASHBY_HOSTS = new Set(["jobs.ashbyhq.com", "job-boards.ashbyhq.com"]);

function isAshbyJobBoardHost(host: string) {
  return host === "jobs.ashbyhq.com" || host === "job-boards.ashbyhq.com" || ASHBY_HOSTS.has(host);
}

function buildCompany(url: URL, identifier: string): Company {
  return {
    name: identifier,
    ats: "ashby",
    identifier,
    domain: url.origin,
    page: `${ASHBY_API_URL}/${identifier}`,
    urls: [],
  };
}

function getAshbyIdentifierFromUrl(url: URL): string | null {
  const host = getHostnameWithoutWww(url);
  const parts = url.pathname.split("/").filter(Boolean);

  // https://jobs.ashbyhq.com/semgrep/embed?version=2
  // https://jobs.ashbyhq.com/semgrep/b3d22389-...
  // https://job-boards.ashbyhq.com/semgrep
  if (isAshbyJobBoardHost(host) && parts[0]) {
    return parts[0];
  }

  // https://api.ashbyhq.com/posting-api/job-board/semgrep
  const apiMatch = url.pathname.match(/\/posting-api\/job-board\/([^/?#]+)/i);

  return apiMatch?.[1] ?? null;
}

async function findEmbeddedAshbyIdentifier(url: URL): Promise<string | null> {
  try {
    const res = await fetch(url.href);

    if (!res.ok) {
      return null;
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    const embedSrc = $("script[src*='ashbyhq.com'], iframe[src*='ashbyhq.com']")
      .first()
      .attr("src");

    if (embedSrc) {
      const identifier = getAshbyIdentifierFromUrl(new URL(embedSrc, url.href));
      if (identifier) return identifier;
    }

    const baseUrlMatch = html.match(
      /(?:__ashbyBaseJobBoardUrl|ashbyBaseJobBoardUrl)\s*(?::|=)\s*["'](https?:\/\/(?:jobs|job-boards)\.ashbyhq\.com\/[^"'?#\s]+)["']/i
    );

    if (baseUrlMatch?.[1]) {
      return getAshbyIdentifierFromUrl(new URL(baseUrlMatch[1]));
    }

    return (
      html.match(
        /https?:\/\/(?:jobs|job-boards)\.ashbyhq\.com\/([^/"'?#\s]+)(?:\/embed|\?embed=js|["'?#\s])/i
      )?.[1] ?? null
    );
  } catch {
    return null;
  }
}

export function isAshbyUrl(url: URL): boolean {
  const host = getHostnameWithoutWww(url);

  return (
    isAshbyJobBoardHost(host) || host.includes("ashbyhq.com") || url.searchParams.has("ashby_jid")
  );
}

export const AshbyJobSchema = z.object({
  id: z.string(),
  title: z.string(),
  location: z.string().optional(),
  jobUrl: z.string(),
  publishedAt: z.string(),
});

export type AshbyJob = z.infer<typeof AshbyJobSchema>;

export const AshbyResponseSchema = z.object({
  jobs: z.array(AshbyJobSchema),
});

export class AshbyFetcher extends ATSFetcher<AshbyJob> {
  readonly ats = "ashby" as const;

  companyKeyFromUrl(url: URL): string {
    const syncIdentifier = this.getSyncIdentifier(url);

    if (syncIdentifier) {
      return this.companyKey(syncIdentifier);
    }

    return this.companyKey(`host:${getHostnameWithoutWww(url)}`);
  }

  async formCompany(url: URL): Promise<Company> {
    const syncIdentifier = this.getSyncIdentifier(url);

    if (syncIdentifier) {
      return buildCompany(url, syncIdentifier);
    }

    // Case 3: scrape embedded Ashby identifier from careers HTML
    const embeddedIdentifier = await findEmbeddedAshbyIdentifier(url);
    if (embeddedIdentifier) {
      return buildCompany(url, embeddedIdentifier);
    }

    // Case 4: fallback
    return buildCompany(url, getSubdomainIdentifier(url));
  }

  /**
   * Identifier known from the URL alone (no network).
   * Returns null when HTML scrape is required.
   */
  private getSyncIdentifier(url: URL): string | null {
    const host = getHostnameWithoutWww(url);

    // Case 0: known manual overrides
    if (identifierMap[host]) {
      return identifierMap[host];
    }

    // Case 1: Ashby job board hosts
    if (isAshbyJobBoardHost(host)) {
      return getAshbyIdentifierFromUrl(url) || getSubdomainIdentifier(url);
    }

    // Case 2: API posting URL
    const directIdentifier = getAshbyIdentifierFromUrl(url);
    if (directIdentifier) {
      return directIdentifier;
    }

    return null;
  }

  protected getJobsFromResponse(data: unknown): AshbyJob[] {
    const parsed = AshbyResponseSchema.safeParse(data);

    if (!parsed.success) {
      logger.error({ data, issues: parsed.error.issues }, `${RED_CROSS} Invalid Ashby response`);

      return [];
    }

    return parsed.data.jobs;
  }

  protected getJobLink(job: AshbyJob, _company: Company): string {
    void _company;
    return job.jobUrl;
  }

  protected normalizeJob(job: AshbyJob, company: Company): Job {
    return {
      company: capitalize(company.name),
      role: job.title,
      link: this.getJobLink(job, company),
      location: job.location ?? "",
    };
  }

  async fetch(
    company: Company,
    knownKeys: ReadonlySet<string>,
    signal: AbortSignal
  ): Promise<Job[]> {
    try {
      const res = await fetch(company.page, {
        signal,
      });

      if (!res.ok) {
        await appendErrorLog(`Ashby: ${company.name} - ${res.status} - ${res.statusText}`);
        return [];
      }

      const rawJobs = this.getJobsFromResponse(await res.json());

      const opportunities = rawJobs
        .filter(
          (job) =>
            isTarget(job.title) &&
            !this.isKnownJob(this.getJobLink(job, company), knownKeys) &&
            withinDays(job.publishedAt)
        )
        .map((job) => this.normalizeJob(job, company));

      return opportunities;
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
          "⚠️ Ashby request aborted"
        );

        return [];
      }

      logger.error(
        {
          error,
          company: company.name,
          url: company.page,
        },
        `${RED_CROSS} Error fetching ashby jobs`
      );

      return [];
    }
  }
}

export const ashbyFetcher = new AshbyFetcher();
