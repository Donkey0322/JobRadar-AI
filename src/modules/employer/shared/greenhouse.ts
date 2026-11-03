import * as cheerio from "cheerio";

import { escapeRegExp, getHostnameWithoutWww, getSubdomainIdentifier } from "@/utils/url";

const identifierMap: Record<string, string> = {
  "8am.com": "affinipay1",
  "airbnb.com": "airbnb",
  "boomi.com": "boomilp",
  "c3.ai": "c3iot",
  "careers.airbnb.com": "airbnb",
  "careers.dat.com": "datsolutions",
  "corporate.trustpilot.com": "trustpilot",
  "cra.com": "charlesriveranalytics90",
  "databricks.com": "databricks",
  "digitalocean.com": "digitalocean98",
  "dltrading.io": "confidentialsportstradingfirm",
  "duolingo.com": "duolingo",
  "epicgames.com": "epicgames",
  "equipmentshare.com": "equipmentsharecom",
  "getfiber.ai": "clerkie",
  "hubspot.com": "hubspotjobs",
  "konrad.com": "konradgroup",
  "mlb.com": "majorleaguebaseball",
  "mongodb.com": "mongodb",
  "pinterestcareers.com": "pinterest",
  "precisely.com": "preciselyusjobs",
  "quantbot.com": "quantbot-technologies",
  "rentptr.com": "premiertruckrental",
  "riotgames.com": "riotgames",
  "roblox.com": "roblox",
  "samsara.com": "samsara",
  "solarwinds.com": "solarwinds",
  "squarepoint-capital.com": "squarepointcapital",
  "tower-research.com": "towerresearchcapital",
  "weareroku.com": "roku",
  "hudsonrivertrading.com": "wehrtyou",
  "verition.com": "veritiongroupllc",
  "withwaymo.com": "waymo",
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

export interface GreenhousePostingRef {
  board: string | null;
  jobId: string;
}

const BOARD_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function cleanBoard(value: string | undefined): string | null {
  if (!value) return null;

  let board: string;
  try {
    board = decodeURIComponent(value);
  } catch {
    board = value;
  }

  if (!BOARD_TOKEN.test(board) || board === "embed") return null;
  return board;
}

/** Board slug assigned to a JS variable used inside an uninterpolated Greenhouse URL. */
function boardFromJsTemplate(html: string): string | null {
  const names = new Set<string>();
  const template =
    /(?:boards-api\.greenhouse\.io\/v1\/boards|(?:job-)?boards\.greenhouse\.io)\/\$\{([A-Za-z_$][\w$]*)\}|\?for=\$\{([A-Za-z_$][\w$]*)\}|greenhouse\.io\/embed\/job_board\/(?:js)?\?for=['"]\s*\+\s*(?:encodeURIComponent\s*\(\s*)?([A-Za-z_$][\w$]*)/gi;

  for (const match of html.matchAll(template)) {
    const name = match[1] ?? match[2] ?? match[3];
    if (name) names.add(name);
  }

  for (const name of names) {
    const assigned = html.match(
      new RegExp(
        String.raw`(?:const|let|var)\s+${escapeRegExp(name)}\s*=\s*['"]([A-Za-z0-9][A-Za-z0-9_-]*)['"]`
      )
    );
    const board = cleanBoard(assigned?.[1]);
    if (board) return board;
  }

  return null;
}

function greenhouseBoardFromHtml(html: string): string | null {
  const embedded = cleanBoard(
    html.match(
      /(?:boards|job-boards)(?:\.[a-z]+)?\.greenhouse\.io\/embed\/job_board\/(?:js)?\?for=([^"'&\s]+)/i
    )?.[1]
  );
  if (embedded) return embedded;

  const api = cleanBoard(
    html.match(/boards-api\.greenhouse\.io\\?\/v1\\?\/boards\\?\/([^/"'?#\\\s]+)/i)?.[1]
  );
  if (api) return api;

  const token = cleanBoard(
    html.match(/name=["']board_token["'][^>]*?\bvalue=["']([^"']+)["']/i)?.[1]
  );
  if (token) return token;

  return boardFromJsTemplate(html);
}

/** Long requisition id at the end of a career slug, such as `...-start-6865704002`. */
function slugJobId(pageUrl: string): string | null {
  try {
    const slug = new URL(pageUrl).pathname.split("/").filter(Boolean).at(-1);
    return slug?.match(/-(\d{7,})$/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Job id a mapped career site puts outside the board path, e.g. `?id=243853` or `...-start-6865704002`. */
export function greenhouseCareerSiteJobId(url: URL): string | null {
  const id = url.searchParams.get("id");
  if (id && /^\d+$/.test(id)) return id;
  return slugJobId(url.href);
}

/**
 * Read a Greenhouse board and job id from a career page.
 * A trailing slug number counts only after the HTML shows this page is Greenhouse.
 */
export function greenhousePostingFromHtml(
  pageUrl: string,
  html: string
): GreenhousePostingRef | null {
  const pairs: Array<{ board: string; jobId: string }> = [];
  const jobUrl =
    /https?:\\?\/\\?\/(?:job-boards|boards)\.greenhouse\.io\\?\/([^/?#'"\\\s]+)\\?\/jobs\\?\/(\d+)/gi;
  const apiJob =
    /boards-api\.greenhouse\.io\\?\/v1\\?\/boards\\?\/([^/"'?#\\\s]+)\\?\/jobs\\?\/(\d+)/gi;

  for (const match of html.matchAll(jobUrl)) {
    const board = cleanBoard(match[1]);
    if (board && match[2]) pairs.push({ board, jobId: match[2] });
  }

  for (const match of html.matchAll(apiJob)) {
    const board = cleanBoard(match[1]);
    if (board && match[2]) pairs.push({ board, jobId: match[2] });
  }

  const slugId = slugJobId(pageUrl);
  const slugPair = slugId ? pairs.find((pair) => pair.jobId === slugId) : undefined;
  if (slugPair) return slugPair;
  if (pairs.length === 1) return pairs[0];

  const board = greenhouseBoardFromHtml(html);
  const ghJids = [...html.matchAll(/gh_jid=(\d+)/gi)]
    .map((match) => match[1])
    .filter((id): id is string => Boolean(id));
  const confirmed = pairs.length > 0 || board !== null || ghJids.length > 0;
  if (!confirmed) return null;

  const jobId =
    (slugId && ghJids.includes(slugId) ? slugId : undefined) ?? ghJids[0] ?? slugId ?? null;
  if (!jobId) return null;

  const boardForJob = pairs.find((pair) => pair.jobId === jobId)?.board ?? board;
  return { board: boardForJob, jobId };
}

export function canonicalGreenhouseJobUrl(pageUrl: string, posting: GreenhousePostingRef): string {
  if (posting.board) {
    return `https://job-boards.greenhouse.io/${posting.board}/jobs/${posting.jobId}`;
  }

  const url = new URL(pageUrl);
  url.searchParams.set("gh_jid", posting.jobId);
  return url.toString();
}

const GENERIC_HOST_LABELS = new Set(["apply", "boards", "career", "careers", "job", "jobs"]);

/** Company label from a career hostname, skipping a generic first label such as `careers`. */
function greenhouseCompanyLabel(url: URL): string {
  const labels = getHostnameWithoutWww(url).split(".").filter(Boolean);
  const [first, second] = labels;

  if (labels.length >= 3 && first && GENERIC_HOST_LABELS.has(first) && second) {
    return second;
  }

  return first || "unknown";
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
      const identifier = cleanBoard(embedUrl.searchParams.get("for") ?? undefined);
      if (identifier) return identifier;

      const parts = embedUrl.pathname.split("/").filter(Boolean);
      if (isGreenhouseJobBoardHost(getHostnameWithoutWww(embedUrl))) {
        const board = cleanBoard(parts[0]);
        if (board) return board;
      }
    }

    return greenhouseBoardFromHtml(html);
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

  return greenhouseCompanyLabel(url);
}
