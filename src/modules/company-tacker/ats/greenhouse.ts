import * as cheerio from "cheerio";

import { GREENHOUSE_API_URL } from "@/constants/ats";
import { RED_CROSS } from "@/constants/log";

import type { Company } from "../type";

import { isTarget, withinDays } from "../utils";

import { appendErrorLog } from "@/utils/data";
import { logger } from "@/utils/logger";

const identifierMap: Record<string, string> = {
  "mlb.com": "majorleaguebaseball",
};

interface GreenhouseJob {
  company_name: string;
  title: string;
  absolute_url: string;
  first_published: string;
  updated_at: string;

  location?: {
    name: string;
  };
}
function getHost(url: URL) {
  return url.hostname.replace(/^www\./, "");
}

function getHostIdentifier(url: URL) {
  return getHost(url).split(".")[0] || "unknown";
}

function isGreenhouseJobBoardHost(host: string) {
  return (
    host === "boards.greenhouse.io" ||
    host === "job-boards.greenhouse.io" ||
    (host.endsWith(".greenhouse.io") &&
      (host.startsWith("boards.") || host.startsWith("job-boards.")))
  );
}

function buildCompany(url: URL, identifier: string): Company {
  return {
    name: identifier,
    ats: "greenhouse",
    identifier,
    domain: url.origin,
    page: `${GREENHOUSE_API_URL}/${identifier}/jobs`,
    urls: [],
  };
}

async function findEmbeddedGreenhouseIdentifier(url: URL): Promise<string | null> {
  try {
    const res = await fetch(url.href, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      },
    });

    if (!res.ok) {
      return null;
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    const embedSrc = $("script[src*='greenhouse.io'], iframe[src*='greenhouse.io']")
      .first()
      .attr("src");

    if (embedSrc) {
      const embedUrl = new URL(embedSrc, url.href);
      const identifier = embedUrl.searchParams.get("for");

      if (identifier) {
        return identifier;
      }

      const parts = embedUrl.pathname.split("/").filter(Boolean);

      if (isGreenhouseJobBoardHost(getHost(embedUrl)) && parts[0] && parts[0] !== "embed") {
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

export async function urlToGreenhouseCompany(url: URL): Promise<Company> {
  const parts = url.pathname.split("/").filter(Boolean);
  const host = getHost(url);

  // case 0:
  if (identifierMap[host as keyof typeof identifierMap]) {
    return buildCompany(url, identifierMap[host]);
  }

  // Case 1:
  // https://boards.greenhouse.io/embed/job_board?for=xxx
  // https://boards.greenhouse.io/embed/job_board/js?for=xxx
  // https://boards.eu.greenhouse.io/embed/job_board?for=xxx
  if (isGreenhouseJobBoardHost(host) && parts[0] === "embed") {
    const identifier = url.searchParams.get("for") || getHostIdentifier(url);

    return buildCompany(url, identifier);
  }

  // Case 2:
  // https://job-boards.greenhouse.io/acluinternships/jobs/8425459002
  // https://job-boards.eu.greenhouse.io/imc/jobs/4580809101
  // https://boards.greenhouse.io/acluinternships
  if (isGreenhouseJobBoardHost(host)) {
    const identifier = parts[0] || getHostIdentifier(url);

    return buildCompany(url, identifier);
  }

  // Case 3:
  // https://app.careerpuck.com/job-board/lyft/job/8215921002?gh_jid=8215921002
  if (host === "app.careerpuck.com") {
    const jobBoardIndex = parts.indexOf("job-board");
    const identifier = parts[jobBoardIndex + 1] || getHostIdentifier(url);

    return buildCompany(url, identifier);
  }

  // Case 4:
  // https://www.acadian-asset.com/careers/open-positions?gh_jid=4645552006
  const embeddedIdentifier = await findEmbeddedGreenhouseIdentifier(url);

  if (embeddedIdentifier) {
    return buildCompany(url, embeddedIdentifier);
  }

  // Case 5:
  // fallback: keep old behavior, never return empty identifier
  const identifier = getHostIdentifier(url);

  return buildCompany(url, identifier);
}

export async function fetchGreenhouse(company: Company, urls: Set<string>, signal: AbortSignal) {
  try {
    const res = await fetch(company.page, {
      signal,
    });

    if (!res.ok) {
      await appendErrorLog(`Greenhouse: ${company.name} - ${res.status} - ${res.statusText}`);

      return [];
    }

    const data = await res.json();

    if (!data?.jobs) {
      logger.warn(
        {
          company: company.name,
        },
        "⚠️ Greenhouse missing jobs field"
      );

      return [];
    }

    const jobs: GreenhouseJob[] = data.jobs.filter(
      (job: GreenhouseJob) =>
        job?.title &&
        job?.absolute_url &&
        isTarget(job.title) &&
        !urls.has(job.absolute_url) &&
        (withinDays(job.first_published) || withinDays(job.updated_at))
    );

    return jobs.map((job) => ({
      company: job.company_name || company.name,
      role: job.title,
      link: job.absolute_url,
      location: job.location?.name ?? "",
    }));
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
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
