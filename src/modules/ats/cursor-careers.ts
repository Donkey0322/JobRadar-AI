import { isAbortError } from "@/utils/http";

export const CURSOR_ASHBY_IDENTIFIER = "cursor";
export const CURSOR_CAREERS_URL = "https://cursor.com/careers";

const JOB_ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * Cursor's hosted Ashby page 404s. The public posting lives on cursor.com and
 * the slug is embedded next to the Ashby id, with the quotes escaped.
 * Stop at the next id so a posting without a slug cannot take the next one.
 */
const ESCAPED_SLUG = new RegExp(
  `\\\\"id\\\\":\\\\"(${JOB_ID})\\\\"(?:(?!\\\\"id\\\\":)[\\s\\S])*?\\\\"urlSlug\\\\":\\\\"([^\\\\"]+)\\\\"`,
  "gi"
);

const RAW_SLUG = new RegExp(`"id":"(${JOB_ID})"(?:(?!"id":)[\\s\\S])*?"urlSlug":"([^"]+)"`, "gi");

export function isCursorAshbyBoard(identifier: string): boolean {
  return identifier.toLowerCase() === CURSOR_ASHBY_IDENTIFIER;
}

export function cursorCareerJobUrl(slug: string, id: string): string {
  const url = new URL(`${CURSOR_CAREERS_URL}/${encodeURIComponent(slug)}`);
  url.searchParams.set("ashby_jid", id);
  return url.toString();
}

function addSlugs(html: string, pattern: RegExp, slugs: Map<string, string>) {
  pattern.lastIndex = 0;

  for (const match of html.matchAll(pattern)) {
    const id = match[1]?.toLowerCase();
    const slug = match[2];

    if (!id || !slug || !/^[a-z0-9-]+$/i.test(slug)) continue;

    slugs.set(id, slug);
  }
}

/** Ashby posting id to the cursor.com/careers path segment. */
export function parseCursorCareerSlugs(html: string): Map<string, string> {
  const slugs = new Map<string, string>();
  addSlugs(html, ESCAPED_SLUG, slugs);
  addSlugs(html, RAW_SLUG, slugs);
  return slugs;
}

/**
 * One read of the careers page. Null when the page cannot be read, so the
 * caller can keep the Ashby job URL for that run.
 */
export async function fetchCursorCareerSlugs(
  signal: AbortSignal
): Promise<Map<string, string> | null> {
  try {
    const response = await fetch(CURSOR_CAREERS_URL, {
      signal,
      headers: { Accept: "text/html" },
    });

    if (!response.ok) return null;

    return parseCursorCareerSlugs(await response.text());
  } catch (error) {
    if (isAbortError(error)) throw error;
    return null;
  }
}
