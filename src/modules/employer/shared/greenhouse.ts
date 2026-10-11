import * as cheerio from "cheerio";

import { getHostnameWithoutWww, getSubdomainIdentifier } from "@/utils/url";

const identifierMap: Record<string, string> = {
  "8am.com": "affinipay1",
  "airbnb.com": "airbnb",
  "boomi.com": "boomilp",
  "c3.ai": "c3iot",
  "careers.airbnb.com": "airbnb",
  "careers.dat.com": "datsolutions",
  "corporate.trustpilot.com": "trustpilot",
  "cra.com": "charlesriveranalytics90",
  "digitalocean.com": "digitalocean98",
  "dltrading.io": "confidentialsportstradingfirm",
  "duolingo.com": "duolingo",
  "getfiber.ai": "clerkie",
  "mlb.com": "majorleaguebaseball",
  "pinterestcareers.com": "pinterest",
  "precisely.com": "preciselyusjobs",
  "rentptr.com": "premiertruckrental",
  "solarwinds.com": "solarwinds",
  "squarepoint-capital.com": "squarepointcapital",
  "tower-research.com": "towerresearchcapital",
  "verition.com": "veritiongroupllc",
  "zipline.com": "flyzipline",

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

export function isGreenhouseJobBoardHost(host: string) {
  return (
    host === "boards.greenhouse.io" ||
    host === "job-boards.greenhouse.io" ||
    (host.endsWith(".greenhouse.io") &&
      (host.startsWith("boards.") || host.startsWith("job-boards.")))
  );
}

/** Identifier known from the URL alone. Null when a redirect or HTML scrape is required. */
export function greenhouseSyncIdentifier(url: URL): string | null {
  const parts = url.pathname.split("/").filter(Boolean);
  const host = getHostnameWithoutWww(url);

  const mapped = mappedIdentifier(host);
  if (mapped) {
    return mapped;
  }

  if (isGreenhouseJobBoardHost(host) && parts[0] === "embed") {
    const forParam = url.searchParams.get("for");
    if (forParam) {
      return forParam;
    }

    if (parts[1] === "job_app") {
      return null;
    }

    return getSubdomainIdentifier(url);
  }

  if (isGreenhouseJobBoardHost(host)) {
    return parts[0] || getSubdomainIdentifier(url);
  }

  if (host === "app.careerpuck.com") {
    const jobBoardIndex = parts.indexOf("job-board");
    const companySlug = parts[jobBoardIndex + 1];

    if (companySlug) {
      return identifierMap[companySlug] || companySlug;
    }
  }

  return null;
}

async function findEmbeddedGreenhouseIdentifier(url: URL): Promise<string | null> {
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
    if (match?.[1]) return match[1];

    return html.match(/boards-api\.greenhouse\.io\/v1\/boards\/([^/"'?#\s]+)/i)?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function resolveGreenhouseIdentifier(url: URL): Promise<string> {
  const syncIdentifier = greenhouseSyncIdentifier(url);
  if (syncIdentifier) {
    return syncIdentifier;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const host = getHostnameWithoutWww(url);

  if (isGreenhouseJobBoardHost(host) && parts[0] === "embed" && parts[1] === "job_app") {
    try {
      const response = await fetch(url.href);
      const identifier = new URL(response.url).searchParams.get("for");
      return identifier || getSubdomainIdentifier(url);
    } catch {
      return getSubdomainIdentifier(url);
    }
  }

  const embeddedIdentifier = await findEmbeddedGreenhouseIdentifier(url);
  if (embeddedIdentifier) {
    return embeddedIdentifier;
  }

  return getSubdomainIdentifier(url);
}
