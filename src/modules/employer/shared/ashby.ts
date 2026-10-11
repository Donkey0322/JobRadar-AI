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
