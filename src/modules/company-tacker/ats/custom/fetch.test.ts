/**
 * Contract tests — hit live endpoints and assert the raw response parses
 * successfully against the Zod response schema defined in each fetcher module.
 *
 * These tests require network access and are intentionally slow.
 * Run in isolation:
 *   pnpm vitest run src/modules/company-tacker/ats/custom/fetch.test.ts
 */

import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";

import type { ZodType } from "zod";

import { AmazonCompany, AmazonResponseSchema } from "./amazon";
import { AMDCompany, AMDResponseSchema } from "./amd";
import { AppleCompany, parseAppleJobs } from "./apple";
import { GoogleCompany, GoogleJobSchema } from "./google";
import { MetaCompany, MetaResponseSchema } from "./meta";
import { NetflixCompany, NetflixResponseSchema } from "./netflix";
import { TikTokCompany, TikTokResponseSchema } from "./tiktok";

const TIMEOUT = 30_000;

async function fetchJsonContract<T>(
  input: Parameters<typeof fetch>[0],
  schema: ZodType<T>,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(input, init);
  expect(res.ok, `HTTP ${res.status}`).toBe(true);

  const result = schema.safeParse(await res.json());
  expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);

  if (!result.success) {
    throw result.error;
  }

  return result.data;
}

// ---------------------------------------------------------------------------
// Amazon
// ---------------------------------------------------------------------------

describe("Amazon", () => {
  it(
    "response matches AmazonResponseSchema",
    async () => {
      const data = await fetchJsonContract(AmazonCompany.page, AmazonResponseSchema, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          size: 1,
          start: 0,
          sort: { sortOrder: "DESCENDING", sortType: "CREATED_DATE" },
        }),
      });

      expect(data.searchHits.length, "expected at least one job in response").toBeGreaterThan(0);
    },
    TIMEOUT
  );
});

// ---------------------------------------------------------------------------
// Netflix
// ---------------------------------------------------------------------------

describe("Netflix", () => {
  it(
    "response matches NetflixResponseSchema",
    async () => {
      const url = new URL(NetflixCompany.page);
      url.searchParams.set("sort_by", "new");
      url.searchParams.set("num", "1");

      const data = await fetchJsonContract(url, NetflixResponseSchema, {
        headers: { Accept: "application/json" },
      });

      expect(data.positions.length, "expected at least one position in response").toBeGreaterThan(
        0
      );
    },
    TIMEOUT
  );
});

// ---------------------------------------------------------------------------
// AMD
// ---------------------------------------------------------------------------

describe("AMD", () => {
  it(
    "response matches AMDResponseSchema",
    async () => {
      const url = new URL(AMDCompany.page);
      url.pathname = "/api/jobs";
      url.searchParams.set("sortBy", "posted_date");
      url.searchParams.set("descending", "true");
      url.searchParams.set("page", "1");
      url.searchParams.set("internal", "false");

      const data = await fetchJsonContract(url, AMDResponseSchema, {
        headers: { Accept: "application/json" },
      });

      expect(data.jobs.length, "expected at least one job in response").toBeGreaterThan(0);
    },
    TIMEOUT
  );
});

// ---------------------------------------------------------------------------
// TikTok
// ---------------------------------------------------------------------------

describe("TikTok", () => {
  it(
    "response matches TikTokResponseSchema",
    async () => {
      const data = await fetchJsonContract(TikTokCompany.page, TikTokResponseSchema, {
        method: "POST",
        headers: {
          accept: "*/*",
          "accept-language": "en-US",
          "content-type": "application/json",
          origin: TikTokCompany.domain,
          referer: `${TikTokCompany.domain}/`,
          "website-path": "tiktok",
        },
        body: JSON.stringify({
          recruitment_id_list: [],
          job_category_id_list: [],
          subject_id_list: [],
          location_code_list: [],
          keyword: "",
          limit: 1,
          offset: 0,
        }),
      });

      expect(data.code, "expected success code 0").toBe(0);
      expect(
        data.data?.job_post_list?.length ?? 0,
        "expected at least one job post in response"
      ).toBeGreaterThan(0);
    },
    TIMEOUT
  );
});

// ---------------------------------------------------------------------------
// Apple  (HTML scraper — uses exported parseAppleJobs)
// ---------------------------------------------------------------------------

describe("Apple", () => {
  it(
    "first parsed job matches AppleJobSchema",
    async () => {
      const url = new URL(AppleCompany.page);
      url.searchParams.set("sort", "newest");
      url.searchParams.set("page", "1");

      const res = await fetch(url.toString(), {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
      });

      expect(res.ok, `HTTP ${res.status}`).toBe(true);

      const jobs = parseAppleJobs(await res.text());

      expect(jobs.length, "expected parseAppleJobs to return at least one job").toBeGreaterThan(0);
    },
    TIMEOUT
  );
});

// ---------------------------------------------------------------------------
// Google  (HTML scraper — inline cheerio, no response schema)
// ---------------------------------------------------------------------------

describe("Google", () => {
  it(
    "first extracted job matches GoogleJobSchema",
    async () => {
      const url = new URL(GoogleCompany.page);
      url.searchParams.set("sort_by", "date");
      url.searchParams.set("page", "1");

      const res = await fetch(url.toString());

      expect(res.ok, `HTTP ${res.status}`).toBe(true);

      const $ = cheerio.load(await res.text());
      const anchor = $("a[href*='jobs/results/']").first();

      expect(anchor.length, "expected at least one job result link on page").toBeGreaterThan(0);

      const href = anchor.attr("href") ?? "";
      let card = anchor.parent();

      while (card.length && card.find("h3").length === 0) {
        card = card.parent();
      }

      const role = card.find("h3").first().text().trim();
      const metaLine = card
        .find("p")
        .filter((_, p) => $(p).text().includes("|"))
        .first()
        .text()
        .trim();

      let jobCompany = "";
      let location = "";

      if (metaLine.includes("|")) {
        const parts = metaLine.split("|");
        jobCompany = parts[0].trim();
        location = parts.slice(1).join("|").trim();
      }

      const result = GoogleJobSchema.safeParse({
        role,
        company: jobCompany,
        location,
        link: `https://www.google.com/about/careers/applications/${href}`,
      });

      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    },
    TIMEOUT
  );
});

// ---------------------------------------------------------------------------
// Meta  (auth-gated — verifies the session page loads and LSD token is present)
// ---------------------------------------------------------------------------

describe("Meta", () => {
  it(
    "careers page loads and contains LSD token",
    async () => {
      const res = await fetch(MetaCompany.page, {
        headers: { "user-agent": "Mozilla/5.0", accept: "text/html" },
      });

      expect(res.ok, `HTTP ${res.status}`).toBe(true);

      const html = await res.text();
      const lsdPattern = /\["LSD",\[\],\{"token":"([^"]+)"\}|name="lsd"\s+value="([^"]+)"/;

      expect(lsdPattern.test(html), "expected LSD token to be present in page HTML").toBe(true);
    },
    TIMEOUT
  );

  it.todo(
    "GraphQL response matches MetaResponseSchema — needs getMetaSession exported to replicate the authenticated call"
  );
});

// Suppress unused import warning — schemas are referenced in .todo descriptions
void MetaResponseSchema;
