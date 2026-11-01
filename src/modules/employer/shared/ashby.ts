import * as cheerio from "cheerio";

import { getHostnameWithoutWww, getSubdomainIdentifier } from "@/utils/url";

const identifierMap: Record<string, { identifier: string; name: string }> = {
  "superhuman.com": {
    identifier: "Superhuman%20Platform%20Inc",
    name: "Superhuman%20Platform%20Inc",
  },
  "skyscanner.com": {
    identifier: "eb485598-6bf3-40a5-8560-d70150131305",
    name: "skyscanner",
  },
};

const ASHBY_HOSTS = new Set(["jobs.ashbyhq.com", "job-boards.ashbyhq.com"]);

export function ashbyBoardOverride(host: string) {
  return identifierMap[host];
}

export function isAshbyJobBoardHost(host: string) {
  return host === "jobs.ashbyhq.com" || host === "job-boards.ashbyhq.com" || ASHBY_HOSTS.has(host);
}

export function getAshbyIdentifierFromUrl(url: URL): string | null {
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

/** Identifier known from the URL alone. Null when an HTML scrape is required. */
export function ashbySyncIdentifier(url: URL): string | null {
  const host = getHostnameWithoutWww(url);

  if (identifierMap[host]) {
    return identifierMap[host].identifier;
  }

  if (isAshbyJobBoardHost(host)) {
    return getAshbyIdentifierFromUrl(url) || getSubdomainIdentifier(url);
  }

  const directIdentifier = getAshbyIdentifierFromUrl(url);
  if (directIdentifier) {
    return directIdentifier;
  }

  return null;
}

export async function resolveAshbyIdentifier(url: URL): Promise<string> {
  const override = ashbyBoardOverride(getHostnameWithoutWww(url));
  if (override) {
    return override.identifier;
  }

  const syncIdentifier = ashbySyncIdentifier(url);
  if (syncIdentifier) {
    return syncIdentifier;
  }

  const embeddedIdentifier = await findEmbeddedAshbyIdentifier(url);
  if (embeddedIdentifier) {
    return embeddedIdentifier;
  }

  return getSubdomainIdentifier(url);
}

const ASHBY_GRAPHQL_URL = "https://jobs.ashbyhq.com/api/non-user-graphql";

const BOARD_POSTINGS_QUERY = `query ApiJobBoardWithTeams($organizationHostedJobsPageName: String!) {
  jobBoard: jobBoardWithTeams(organizationHostedJobsPageName: $organizationHostedJobsPageName) {
    jobPostings {
      id
      title
      locationName
      secondaryLocations { locationName }
    }
  }
}`;

const PUBLISHED_DATE_QUERY = `query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) {
  jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) {
    publishedDate
  }
}`;

export interface PublicAshbyPosting {
  id: string;
  title: string;
  location: string;
}

interface BoardPosting {
  id?: string | null;
  title?: string | null;
  locationName?: string | null;
  secondaryLocations?: Array<{ locationName?: string | null } | null> | null;
}

export function ashbyBoardSlug(identifier: string): string {
  try {
    return decodeURIComponent(identifier);
  } catch {
    return identifier;
  }
}

export function ashbyHostedJobUrl(identifier: string, jobId: string): string {
  return `https://jobs.ashbyhq.com/${encodeURIComponent(ashbyBoardSlug(identifier))}/${jobId}`;
}

/** Primary location, then the other offices on the same posting. */
export function ashbyBoardLocation(posting: BoardPosting): string {
  const names = [
    posting.locationName,
    ...(posting.secondaryLocations ?? []).map((location) => location?.locationName),
  ];
  const unique = [
    ...new Set(names.map((name) => name?.trim()).filter((name): name is string => Boolean(name))),
  ];

  return unique.join("; ");
}

async function ashbyGraphql<T>(
  operationName: string,
  query: string,
  variables: Record<string, string>,
  signal: AbortSignal
): Promise<T | null> {
  const response = await fetch(`${ASHBY_GRAPHQL_URL}?op=${operationName}`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operationName, query, variables }),
  });

  if (!response.ok) return null;

  const body = (await response.json()) as { data?: T; errors?: unknown[] };
  if (body.errors?.length || body.data == null) return null;

  return body.data;
}

/**
 * Jobs on the hosted board. Null when that board is missing.
 * The list type has no publishedDate.
 */
export async function fetchAshbyBoardPostings(
  identifier: string,
  signal: AbortSignal
): Promise<PublicAshbyPosting[] | null> {
  const slug = ashbyBoardSlug(identifier);
  if (!slug) return null;

  const data = await ashbyGraphql<{
    jobBoard: { jobPostings?: BoardPosting[] | null } | null;
  }>(
    "ApiJobBoardWithTeams",
    BOARD_POSTINGS_QUERY,
    { organizationHostedJobsPageName: slug },
    signal
  );

  const postings = data?.jobBoard?.jobPostings;
  if (!postings) return null;

  return postings.flatMap((posting) => {
    if (!posting.id || !posting.title) return [];

    return [
      {
        id: posting.id,
        title: posting.title,
        location: ashbyBoardLocation(posting),
      },
    ];
  });
}

/** Publish date for one hosted posting. The board list does not include it. */
export async function fetchAshbyPublishedDate(
  identifier: string,
  jobId: string,
  signal: AbortSignal
): Promise<string | null> {
  const slug = ashbyBoardSlug(identifier);
  if (!slug || !jobId) return null;

  const data = await ashbyGraphql<{ jobPosting: { publishedDate?: string | null } | null }>(
    "ApiJobPosting",
    PUBLISHED_DATE_QUERY,
    { organizationHostedJobsPageName: slug, jobPostingId: jobId },
    signal
  );

  const date = data?.jobPosting?.publishedDate;
  return typeof date === "string" && date ? date : null;
}
