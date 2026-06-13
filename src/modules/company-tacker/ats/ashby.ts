import * as cheerio from "cheerio";

import { ASHBY_API_URL } from "@/constants/ats";
import { RED_CROSS } from "@/constants/log";

import type { Company } from "../type";

import { isTarget, withinDays } from "../utils";

import { appendErrorLog } from "@/utils/data";
import { logger } from "@/utils/logger";
import { capitalize } from "@/utils/string";

const identifierMap: Record<string, string> = {
  "superhuman.com": "Superhuman%20Platform%20Inc",
};

export interface AshbyJob {
  id: string;
  title: string;
  location: string;
  jobUrl: string;
  publishedAt: string;
}

const ASHBY_HOSTS = new Set(["jobs.ashbyhq.com", "job-boards.ashbyhq.com"]);

function getHost(url: URL) {
  return url.hostname.replace(/^www\./, "");
}

function getHostIdentifier(url: URL) {
  return getHost(url).split(".")[0] || "unknown";
}

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
  const host = getHost(url);
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
  const host = getHost(url);

  return (
    isAshbyJobBoardHost(host) || host.includes("ashbyhq.com") || url.searchParams.has("ashby_jid")
  );
}

export async function urlToAshbyCompany(url: URL): Promise<Company> {
  const host = getHost(url);

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
    const identifier = getAshbyIdentifierFromUrl(url) || getHostIdentifier(url);

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
  const identifier = getHostIdentifier(url);

  return buildCompany(url, identifier);
}

export async function fetchAshby(company: Company, urls: Set<string>, signal: AbortSignal) {
  try {
    const res = await fetch(company.page, {
      signal,
    });

    if (!res.ok) {
      await appendErrorLog(`Ashby: ${company.name} - ${res.status} - ${res.statusText}`);
      return [];
    }

    const data = await res.json();

    if (!data?.jobs) {
      logger.warn(
        {
          company: company.name,
          url: company.page,
        },
        "⚠️ Ashby missing jobs field"
      );

      return [];
    }

    const jobs: AshbyJob[] = data.jobs.filter(
      (job: AshbyJob) =>
        job?.title &&
        job?.jobUrl &&
        isTarget(job.title) &&
        !urls.has(job.jobUrl) &&
        withinDays(job.publishedAt)
    );

    return jobs.map((job) => ({
      company: capitalize(company.name),
      role: job.title,
      link: job.jobUrl,
      location: job.location ?? "",
    }));
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
