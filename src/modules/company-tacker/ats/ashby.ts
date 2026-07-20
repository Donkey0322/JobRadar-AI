import * as cheerio from "cheerio";
import z from "zod";

import { ASHBY_API_URL } from "@/constants/ats";
import { RED_CROSS } from "@/constants/log";

import type { Company } from "../type";
import type { Job } from "@/types";

import { isTarget, withinDays } from "../utils";

import { ATSFetcher } from "./class";

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

  async formCompany(url: URL): Promise<Company> {
    const host = getHostnameWithoutWww(url);

    // Case 0:
    // Known manual overrides
    if (identifierMap[host]) {
      return buildCompany(url, identifierMap[host]);
    }

    // Case 1:
    // https://jobs.ashbyhq.com/semgrep
    // https://jobs.ashbyhq.com/semgrep/embed?version=2
    // https://jobs.ashbyhq.com/semgrep/b3d22389-...
    if (isAshbyJobBoardHost(host)) {
      const identifier = getAshbyIdentifierFromUrl(url) || getSubdomainIdentifier(url);

      return buildCompany(url, identifier);
    }

    // Case 2:
    // https://api.ashbyhq.com/posting-api/job-board/semgrep
    const directIdentifier = getAshbyIdentifierFromUrl(url);
    if (directIdentifier) {
      return buildCompany(url, directIdentifier);
    }

    // Case 3:
    // https://semgrep.dev/about/careers/?ashby_jid=...
    // Fetch page HTML and find Ashby embed script / iframe / base job board URL
    const embeddedIdentifier = await findEmbeddedAshbyIdentifier(url);
    if (embeddedIdentifier) {
      return buildCompany(url, embeddedIdentifier);
    }

    // Case 4:
    // fallback: keep old behavior, never return empty identifier
    const identifier = getSubdomainIdentifier(url);

    return buildCompany(url, identifier);
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

  async fetch(company: Company, urls: Set<string>, signal: AbortSignal): Promise<Job[]> {
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
            !urls.has(this.getJobLink(job, company)) &&
            withinDays(job.publishedAt)
        )
        .map((job) => this.normalizeJob(job, company));

      return opportunities;
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
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
