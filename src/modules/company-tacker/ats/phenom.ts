import z from "zod";

import { ABORT_SIGNAL } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { Company } from "../type";
import type { Job } from "@/types";

import { isTarget, withinDays } from "@/modules/company-tacker/utils";
import { logger } from "@/utils/logger";

export const TRACKING_PARAM = "ph_id";

const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const RECENT_DAYS = 2;

const PHENOM_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/149.0.0.0 Safari/537.36";

const PHENOM_ALL_FIELDS = [
  "remote",
  "country",
  "state",
  "city",
  "experienceLevel",
  "category",
  "profession",
  "employmentType",
  "jobLevel",
] as const;

export const PhenomJobSchema = z
  .object({
    jobId: z.union([z.string(), z.number()]).transform(String),
    title: z.string(),
    postedDate: z.string(),

    city: z.string().nullish(),
    cityState: z.string().nullish(),
    cityStateCountry: z.string().nullish(),
    location: z.string().nullish(),
  })
  .passthrough();

export type PhenomJob = z.infer<typeof PhenomJobSchema>;

const PhenomResponseSchema = z.object({
  refineSearch: z.object({
    data: z.object({
      jobs: z.array(PhenomJobSchema),
    }),
  }),
});

interface PhenomSession {
  csrfToken: string;
  cookie: string;
  companyName: string | null;

  pageUrl: string;
  baseUrl: string;
  widgetsUrl: string;
}

export async function isPhenomUrl(rawUrl: string): Promise<boolean> {
  try {
    const response = await fetch(rawUrl, {
      redirect: "follow",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
        "user-agent": PHENOM_USER_AGENT,
      },
    });

    if (!response.ok) {
      return false;
    }

    const html = await response.text();
    const setCookie = response.headers.get("set-cookie") ?? "";

    return (
      /phenompeople/i.test(html) ||
      /data-ph-id=/i.test(html) ||
      /ph-page-element/i.test(html) ||
      /PHPPPE_/i.test(html) ||
      /PHPPPE_/i.test(setCookie) ||
      (/jobSeqNo=/i.test(html) && /\/widgets/i.test(html))
    );
  } catch {
    return false;
  }
}

export async function urlToPhenomCompany(url: URL): Promise<Company | null> {
  return {
    name: url.hostname,
    ats: "phenom",
    identifier: url.hostname,
    domain: url.origin,
    page: url.origin,
    urls: [],
  };
}

function removeTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#34;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#x2F;", "/")
    .replaceAll("&#47;", "/")
    .replace(/\s+/g, " ")
    .trim();
}

function isHtmlResponse(raw: string): boolean {
  const trimmed = raw.trimStart().toLowerCase();

  return (
    trimmed.startsWith("<!doctype") || trimmed.startsWith("<?xml") || trimmed.startsWith("<html")
  );
}

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function getLocaleBaseUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);

    const segments = url.pathname
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean);

    for (let index = 0; index < segments.length - 1; index++) {
      const region = segments[index];
      const language = segments[index + 1];

      const isRegion =
        region.toLowerCase() === "global" ||
        /^[a-z]{2}$/i.test(region) ||
        /^[a-z]{2}-[a-z]{2}$/i.test(region);

      const isLanguage = /^[a-z]{2}$/i.test(language) || /^[a-z]{2}-[a-z]{2}$/i.test(language);

      if (!isRegion || !isLanguage) {
        continue;
      }

      const prefix = segments.slice(0, index + 2).join("/");

      return `${url.origin}/${prefix}`;
    }

    return null;
  } catch {
    return null;
  }
}

function extractHtmlUrls(html: string, pageUrl: string): string[] {
  const urls = new Set<string>();

  const attributePatterns = [
    /<link\b[^>]*\brel=["'][^"']*\bcanonical\b[^"']*["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi,
    /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["'][^"']*\bcanonical\b[^"']*["'][^>]*>/gi,
    /<link\b[^>]*\bhreflang=["'][^"']+["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi,
    /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\bhreflang=["'][^"']+["'][^>]*>/gi,
    /<meta\b[^>]*\bproperty=["']og:url["'][^>]*\bcontent=["']([^"']+)["'][^>]*>/gi,
    /<meta\b[^>]*\bcontent=["']([^"']+)["'][^>]*\bproperty=["']og:url["'][^>]*>/gi,
  ];

  for (const pattern of attributePatterns) {
    for (const match of html.matchAll(pattern)) {
      const value = match[1];

      if (!value) {
        continue;
      }

      try {
        const decoded = decodeHtmlEntities(value);
        urls.add(new URL(decoded, pageUrl).href);
      } catch {
        // Ignore malformed URLs.
      }
    }
  }

  let origin: string;

  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return [...urls];
  }

  const escapedOrigin = escapeRegExp(origin);

  const embeddedPatterns = [
    new RegExp(
      `${escapedOrigin}(?:\\\\/|/)+(?:global|[a-z]{2})` +
        `(?:\\\\/|/)+[a-z]{2}(?:(?:\\\\/|/)[^"'\\s<]*)?`,
      "gi"
    ),
    /["']((?:\/|\\\/)+(?:global|[a-z]{2})(?:\/|\\\/)+[a-z]{2}(?:(?:\/|\\\/)[^"'\\s<]*)?)["']/gi,
  ];

  for (const pattern of embeddedPatterns) {
    for (const match of html.matchAll(pattern)) {
      const value = match[1] ?? match[0];

      if (!value) {
        continue;
      }

      try {
        const decoded = decodeHtmlEntities(value).replaceAll("\\/", "/");

        urls.add(new URL(decoded, pageUrl).href);
      } catch {
        // Ignore malformed URLs.
      }
    }
  }

  return [...urls];
}

function resolvePhenomBaseUrl(requestedUrl: string, responseUrl: string, html: string): string {
  const redirectedBaseUrl = getLocaleBaseUrl(responseUrl);

  if (redirectedBaseUrl) {
    return removeTrailingSlash(redirectedBaseUrl);
  }

  const responseOrigin = new URL(responseUrl).origin;
  const htmlUrls = extractHtmlUrls(html, responseUrl);

  for (const htmlUrl of htmlUrls) {
    try {
      const candidate = new URL(htmlUrl);

      if (candidate.origin !== responseOrigin) {
        continue;
      }

      const baseUrl = getLocaleBaseUrl(candidate.href);

      if (baseUrl) {
        return removeTrailingSlash(baseUrl);
      }
    } catch {
      // Ignore malformed candidates.
    }
  }

  const requestedBaseUrl = getLocaleBaseUrl(requestedUrl);

  if (requestedBaseUrl) {
    return removeTrailingSlash(requestedBaseUrl);
  }

  return removeTrailingSlash(responseOrigin);
}

function extractMetaContent(
  html: string,
  attribute: "property" | "name",
  key: string
): string | null {
  const escapedKey = escapeRegExp(key);

  const patterns = [
    new RegExp(
      `<meta\\b[^>]*\\b${attribute}=["']${escapedKey}["']` +
        `[^>]*\\bcontent=["']([^"']+)["'][^>]*>`,
      "i"
    ),
    new RegExp(
      `<meta\\b[^>]*\\bcontent=["']([^"']+)["']` +
        `[^>]*\\b${attribute}=["']${escapedKey}["'][^>]*>`,
      "i"
    ),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match?.[1]) {
      return decodeHtmlEntities(match[1]);
    }
  }

  return null;
}

function normalizeCompanyName(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/\\u0026/gi, "&")
    .replace(/\\u0027/gi, "'")
    .replace(/\\u002d/gi, "-")
    .replace(/\\\//g, "/")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(careers?|jobs?)\s+(at|with)\s+/i, "")
    .replace(/\s*[|–—]\s*(careers?|jobs?|job search|search jobs|career opportunities).*$/i, "")
    .replace(/\s+-\s+(careers?|jobs?|job search|search jobs|career opportunities).*$/i, "")
    .replace(/\s+(careers?|jobs?|career opportunities)$/i, "")
    .trim();
}

function isGenericCompanyName(value: string): boolean {
  return /^(careers?|jobs?|search jobs|job search|career opportunities|home)$/i.test(value.trim());
}

function extractJsonLdCompanyName(html: string): string | null {
  const scripts = html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );

  for (const match of scripts) {
    const raw = match[1]?.trim();

    if (!raw) {
      continue;
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];

      while (queue.length > 0) {
        const current = queue.shift();

        if (!current || typeof current !== "object") {
          continue;
        }

        const record = current as Record<string, unknown>;
        const rawType = record["@type"];
        const types = Array.isArray(rawType) ? rawType : [rawType];

        const representsCompany = types.some(
          (type) => type === "Organization" || type === "Corporation" || type === "Brand"
        );

        if (representsCompany && typeof record.name === "string") {
          const name = normalizeCompanyName(record.name);

          if (name && !isGenericCompanyName(name)) {
            return name;
          }
        }

        for (const value of Object.values(record)) {
          if (Array.isArray(value)) {
            queue.push(...value);
          } else if (value && typeof value === "object") {
            queue.push(value);
          }
        }
      }
    } catch {
      // Ignore malformed JSON-LD.
    }
  }

  return null;
}

function extractPhenomCompanyName(html: string): string | null {
  const patterns = [
    /"companyName"\s*:\s*"((?:\\.|[^"\\])+)"/i,
    /"company_name"\s*:\s*"((?:\\.|[^"\\])+)"/i,
    /"organizationName"\s*:\s*"((?:\\.|[^"\\])+)"/i,
    /"organization_name"\s*:\s*"((?:\\.|[^"\\])+)"/i,
    /"brandName"\s*:\s*"((?:\\.|[^"\\])+)"/i,
    /"brand_name"\s*:\s*"((?:\\.|[^"\\])+)"/i,
    /companyName["']?\s*[:=]\s*["']([^"']+)["']/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (!match?.[1]) {
      continue;
    }

    const name = normalizeCompanyName(match[1]);

    if (name && !isGenericCompanyName(name)) {
      return name;
    }
  }

  return null;
}

function extractTitleCompanyName(html: string): string | null {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);

  if (!match?.[1]) {
    return null;
  }

  let title = decodeHtmlEntities(match[1]);

  const leadingCareerPatterns = [
    /^(careers?|jobs?)\s+(at|with)\s+/i,
    /^(careers?|jobs?)\s*[:|–—-]\s*/i,
  ];

  for (const pattern of leadingCareerPatterns) {
    title = title.replace(pattern, "");
  }

  const separators = [" | ", " – ", " — ", " - "];

  for (const separator of separators) {
    const parts = title
      .split(separator)
      .map((part) => normalizeCompanyName(part))
      .filter(Boolean);

    if (parts.length < 2) {
      continue;
    }

    const candidate = parts.find(
      (part) => !isGenericCompanyName(part) && !/careers?|jobs?/i.test(part)
    );

    if (candidate) {
      return candidate;
    }
  }

  const normalized = normalizeCompanyName(title);

  if (!normalized || isGenericCompanyName(normalized)) {
    return null;
  }

  return normalized;
}

function extractCompanyName(html: string): string | null {
  const candidates = [
    extractJsonLdCompanyName(html),
    extractMetaContent(html, "property", "og:site_name"),
    extractMetaContent(html, "name", "application-name"),
    extractPhenomCompanyName(html),
    extractTitleCompanyName(html),
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const name = normalizeCompanyName(candidate);

    if (name && !isGenericCompanyName(name)) {
      return name;
    }
  }

  return null;
}

function getSetCookieHeader(response: Response): string {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };

  const setCookies = headers.getSetCookie?.();

  if (setCookies?.length) {
    return setCookies
      .map((cookie) => cookie.split(";")[0])
      .filter(Boolean)
      .join("; ");
  }

  const setCookie = response.headers.get("set-cookie");

  if (!setCookie) {
    return "";
  }

  return setCookie
    .split(/,(?=\s*[^;=]+=[^;]+)/)
    .map((cookie) => cookie.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

function extractPhenomCsrfToken(html: string): string | null {
  const patterns = [
    /"csrfToken"\s*:\s*"([^"]+)"/,
    /csrfToken["']?\s*[:=]\s*["']([^"']+)["']/,
    /name=["']csrfToken["']\s+value=["']([^"']+)["']/,
    /name=["']_csrf["']\s+value=["']([^"']+)["']/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

async function getPhenomSession(pageUrl: string, signal: AbortSignal): Promise<PhenomSession> {
  const response = await fetch(pageUrl, {
    redirect: "follow",
    headers: {
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9," +
        "image/avif,image/webp,image/apng,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      pragma: "no-cache",
      "user-agent": PHENOM_USER_AGENT,
    },
    signal,
  });

  const html = await response.text();

  if (!response.ok || !html) {
    throw new Error(
      `Failed to fetch Phenom careers page: ` + `${response.status} ${response.statusText}`
    );
  }

  const csrfToken = extractPhenomCsrfToken(html);

  if (!csrfToken) {
    throw new Error(`Failed to extract Phenom CSRF token from ${response.url}`);
  }

  const baseUrl = resolvePhenomBaseUrl(pageUrl, response.url, html);

  return {
    csrfToken,
    cookie: getSetCookieHeader(response),
    companyName: extractCompanyName(html),
    pageUrl: response.url,
    baseUrl,
    widgetsUrl: `${baseUrl}/widgets`,
  };
}

function createPhenomHeaders(session: PhenomSession): Record<string, string> {
  const origin = new URL(session.baseUrl).origin;

  const headers: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    "accept-language": "en-US,en;q=0.9",
    "content-type": "application/json",
    origin,
    referer: `${session.baseUrl}/`,
    "user-agent": PHENOM_USER_AGENT,
    "x-csrf-token": session.csrfToken,
    "x-requested-with": "XMLHttpRequest",
  };

  if (session.cookie) {
    headers.cookie = session.cookie;
  }

  return headers;
}

function createPhenomRequestBody(page: number) {
  return {
    lang: "en_us",
    deviceType: "desktop",
    country: "us",
    pageName: "Engineering and Product jobs",
    ddoKey: "refineSearch",
    sortBy: "Most recent",
    subsearch: "",
    from: page * PAGE_SIZE,
    irs: false,
    jobs: true,
    counts: true,
    all_fields: PHENOM_ALL_FIELDS,
    pageType: "category",
    size: PAGE_SIZE,
    rk: "",
    ak: "",
    clearAll: false,
    jdsource: "facets",
    isSliderEnable: false,
    pageId: "page62-ds",
    siteType: "external",
    location: "",
    keywords: "",
    global: true,
    selected_fields: {},
    sort: {
      order: "desc",
      field: "postedDate",
    },
    locationData: {},
  };
}

function getJobsFromPhenomResponse(data: unknown, company: Company): PhenomJob[] {
  const parsed = PhenomResponseSchema.safeParse(data);

  if (!parsed.success) {
    logger.error(
      {
        company: company.name,
        issues: parsed.error.issues,
      },
      `${RED_CROSS} Invalid Phenom response`
    );

    return [];
  }

  return parsed.data.refineSearch.data.jobs;
}

async function fetchPhenomPage(
  company: Company,
  page: number,
  session: PhenomSession,
  signal: AbortSignal
): Promise<PhenomJob[]> {
  const response = await fetch(session.widgetsUrl, {
    method: "POST",
    redirect: "manual",
    headers: createPhenomHeaders(session),
    body: JSON.stringify(createPhenomRequestBody(page)),
    signal,
  });

  const raw = await response.text();

  if (response.status >= 300 && response.status < 400) {
    throw new Error(
      `Phenom widgets redirected on page ${page + 1}: ` +
        `${response.status} ${response.statusText} ` +
        `endpoint=${session.widgetsUrl} ` +
        `location=${response.headers.get("location") ?? ""}`
    );
  }

  if (!response.ok || isHtmlResponse(raw)) {
    throw new Error(
      `Phenom widgets failed on page ${page + 1}: ` +
        `${response.status} ${response.statusText} ` +
        `endpoint=${session.widgetsUrl} ` +
        `baseUrl=${session.baseUrl} ` +
        `pageUrl=${session.pageUrl} ` +
        raw.slice(0, 300)
    );
  }

  let data: unknown;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `Phenom widgets returned invalid JSON on page ${page + 1}: ` +
        `endpoint=${session.widgetsUrl} ` +
        raw.slice(0, 300)
    );
  }

  return getJobsFromPhenomResponse(data, company);
}

function getPhenomJobLink(session: PhenomSession, job: PhenomJob): string {
  return `${session.baseUrl}/job/${job.jobId}?${TRACKING_PARAM}=${job.jobId}`;
}

function getPhenomJobLocation(job: PhenomJob): string {
  return job.location ?? job.cityStateCountry ?? job.cityState ?? job.city ?? "";
}

function normalizePhenomJob(company: Company, job: PhenomJob, link: string): Job {
  return {
    company: company.name,
    role: job.title,
    link,
    location: getPhenomJobLocation(job),
  };
}

export async function fetchPhenom(
  company: Company,
  urls: Set<string>,
  signal: AbortSignal = ABORT_SIGNAL
): Promise<Job[]> {
  try {
    const session = await getPhenomSession(company.page, signal);

    const resolvedCompany: Company = {
      ...company,
      name: session.companyName ?? company.name,
      domain: new URL(session.baseUrl).origin,
      page: session.baseUrl,
    };

    logger.debug(
      {
        company: resolvedCompany.name,
        originalCompany: company.name,
        requestedUrl: company.page,
        pageUrl: session.pageUrl,
        baseUrl: session.baseUrl,
        widgetsUrl: session.widgetsUrl,
      },
      "Resolved Phenom company"
    );

    const jobs: Job[] = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      const rawJobs = await fetchPhenomPage(resolvedCompany, page, session, signal);
      console.log(rawJobs.length);
      if (rawJobs.length === 0) {
        break;
      }

      let reachedOldJob = false;

      for (const rawJob of rawJobs) {
        if (!withinDays(rawJob.postedDate, RECENT_DAYS)) {
          reachedOldJob = true;
          break;
        }

        const link = getPhenomJobLink(session, rawJob);

        if (!isTarget(rawJob.title) || urls.has(link)) {
          continue;
        }

        jobs.push(normalizePhenomJob(resolvedCompany, rawJob, link));
      }

      if (reachedOldJob || rawJobs.length < PAGE_SIZE) {
        break;
      }
    }

    return jobs;
  } catch (error) {
    logger.error(
      {
        err: isAbortError(error) ? error.name : error,
        company: company.name,
        url: company.page,
      },
      `${RED_CROSS} Error fetching Phenom jobs`
    );

    return [];
  }
}
