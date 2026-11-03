import { RIPPLING_API_URL, RIPPLING_BOARD_URL } from "@/constants/ats";

const LOCALE_SEGMENT = /^[a-z]{2}-[a-z]{2}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NEXT_DATA = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;

const BROWSER_HEADERS: HeadersInit = {
  "user-agent": "Mozilla/5.0 (JobRadar)",
};

export function isRipplingHost(url: URL): boolean {
  return url.hostname === "ats.rippling.com";
}

/** Board slug from `/{slug}/jobs/{id}` or `/{locale}/{slug}/jobs/{id}`. */
export function getRipplingSlug(url: URL): string | null {
  const parts = url.pathname.split("/").filter(Boolean);
  const start = parts.length > 1 && LOCALE_SEGMENT.test(parts[0]) ? 1 : 0;
  return parts[start]?.toLowerCase() ?? null;
}

export function getRipplingJobId(url: URL): string | null {
  const parts = url.pathname.split("/").filter(Boolean);
  const jobsIndex = parts.indexOf("jobs");
  const id = jobsIndex === -1 ? undefined : parts[jobsIndex + 1];
  return id && UUID.test(id) ? id.toLowerCase() : null;
}

export function ripplingListingUrl(slug: string): string {
  return `${RIPPLING_API_URL}/${slug}/jobs`;
}

export function ripplingJobUrl(slug: string, id: string): string {
  return `${RIPPLING_BOARD_URL}/${slug}/jobs/${id}`;
}

function readApiData(html: string): Record<string, unknown> | null {
  const raw = html.match(NEXT_DATA)?.[1];
  if (!raw) return null;

  try {
    const data = JSON.parse(raw) as { props?: { pageProps?: { apiData?: unknown } } };
    const apiData = data.props?.pageProps?.apiData;
    return apiData && typeof apiData === "object" ? (apiData as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function stringAt(record: Record<string, unknown> | null, key: string, field: string) {
  const value = record?.[key];
  if (!value || typeof value !== "object") return null;

  const text = (value as Record<string, unknown>)[field];
  return typeof text === "string" && text.trim() ? text.trim() : null;
}

/** Employer name from the board page; `title` is sometimes a slogan. */
export function parseRipplingBoardTitle(html: string): string | null {
  const apiData = readApiData(html);
  return stringAt(apiData, "jobBoard", "companyName") ?? stringAt(apiData, "jobBoard", "title");
}

/** Posting date from a job page's `jobPost.createdOn`. */
export function parseRipplingCreatedOn(html: string): string | null {
  return stringAt(readApiData(html), "jobPost", "createdOn");
}

async function fetchPage(url: string, signal: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(url, { signal, headers: BROWSER_HEADERS });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

export async function fetchRipplingBoardTitle(slug: string): Promise<string | null> {
  const html = await fetchPage(`${RIPPLING_BOARD_URL}/${slug}/jobs`, AbortSignal.timeout(15_000));
  return html ? parseRipplingBoardTitle(html) : null;
}

export async function fetchRipplingCreatedOn(
  link: string,
  signal: AbortSignal
): Promise<string | null> {
  const html = await fetchPage(link, signal);
  return html ? parseRipplingCreatedOn(html) : null;
}
