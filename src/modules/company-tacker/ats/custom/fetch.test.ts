/**
 * Contract tests — hit live endpoints and assert raw response items parse
 * successfully against the Zod schema defined in each fetcher module.
 *
 * These tests require network access and are intentionally slow.
 * Run in isolation:
 *   pnpm vitest run src/modules/company-tacker/ats/custom/fetch.test.ts
 */

import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";

import { AdobeCompany, AdobeJobSchema } from "./adobe";
import { AmazonCompany, AmazonJobSchema } from "./amazon";
import { AMDCompany, AMDJobSchema } from "./amd";
import { AppleCompany, AppleJobSchema, parseAppleJobs } from "./apple";
import { GoogleCompany, GoogleJobSchema } from "./google";
import { MetaCompany, MetaJobSchema } from "./meta";
import { MicrosoftCompany, MicrosoftJobSchema } from "./microsoft";
import { NetflixCompany, NetflixJobSchema } from "./netflix";
import { TikTokCompany, TikTokJobSchema } from "./tiktok";

const TIMEOUT = 30_000;

// ---------------------------------------------------------------------------
// Amazon
// ---------------------------------------------------------------------------

describe("Amazon", () => {
  it(
    "first job matches AmazonJobSchema",
    async () => {
      const res = await fetch(AmazonCompany.page, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          size: 1,
          start: 0,
          sort: { sortOrder: "DESCENDING", sortType: "CREATED_DATE" },
        }),
      });

      expect(res.ok, `HTTP ${res.status}`).toBe(true);

      const data = (await res.json()) as { searchHits: { fields: unknown }[] };
      const jobs = data.searchHits?.map(({ fields }) => fields) ?? [];

      expect(jobs.length, "expected at least one job in response").toBeGreaterThan(0);

      const result = AmazonJobSchema.safeParse(jobs[0]);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    },
    TIMEOUT
  );
});

// ---------------------------------------------------------------------------
// Netflix
// ---------------------------------------------------------------------------

describe("Netflix", () => {
  it(
    "first position matches NetflixJobSchema",
    async () => {
      const url = new URL(NetflixCompany.page);
      url.searchParams.set("sort_by", "new");
      url.searchParams.set("num", "1");

      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
      });

      expect(res.ok, `HTTP ${res.status}`).toBe(true);

      const data = (await res.json()) as { positions: unknown[] };
      const positions = data.positions ?? [];

      expect(positions.length, "expected at least one position in response").toBeGreaterThan(0);

      const result = NetflixJobSchema.safeParse(positions[0]);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    },
    TIMEOUT
  );
});

// ---------------------------------------------------------------------------
// Microsoft
// ---------------------------------------------------------------------------

describe("Microsoft", () => {
  it(
    "first position matches MicrosoftJobSchema",
    async () => {
      const url = new URL(MicrosoftCompany.page);
      url.searchParams.set("start", "0");
      url.searchParams.set("sort_by", "timestamp");

      const res = await fetch(url.toString());

      expect(res.ok, `HTTP ${res.status}`).toBe(true);

      const data = (await res.json()) as { data?: { positions?: unknown[] } };
      const positions = data.data?.positions ?? [];

      expect(positions.length, "expected at least one position in response").toBeGreaterThan(0);

      const result = MicrosoftJobSchema.safeParse(positions[0]);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    },
    TIMEOUT
  );
});

// ---------------------------------------------------------------------------
// AMD
// ---------------------------------------------------------------------------

describe("AMD", () => {
  it(
    "first job matches AMDJobSchema",
    async () => {
      const url = new URL(AMDCompany.page);
      url.pathname = "/api/jobs";
      url.searchParams.set("sortBy", "posted_date");
      url.searchParams.set("descending", "true");
      url.searchParams.set("page", "1");
      url.searchParams.set("internal", "false");

      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
      });

      expect(res.ok, `HTTP ${res.status}`).toBe(true);

      const data = (await res.json()) as { jobs: { data: unknown }[] };
      const jobs = data.jobs?.map((item) => item.data) ?? [];

      expect(jobs.length, "expected at least one job in response").toBeGreaterThan(0);

      const result = AMDJobSchema.safeParse(jobs[0]);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    },
    TIMEOUT
  );
});

// ---------------------------------------------------------------------------
// TikTok
// ---------------------------------------------------------------------------

describe("TikTok", () => {
  it(
    "first job post matches TikTokJobSchema",
    async () => {
      const res = await fetch(TikTokCompany.page, {
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

      expect(res.ok, `HTTP ${res.status}`).toBe(true);

      const json = (await res.json()) as { code: number; data?: { job_post_list?: unknown[] } };

      expect(json.code, "expected success code 0").toBe(0);

      const posts = json.data?.job_post_list ?? [];

      expect(posts.length, "expected at least one job post in response").toBeGreaterThan(0);

      const result = TikTokJobSchema.safeParse(posts[0]);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
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

      const html = await res.text();
      const jobs = parseAppleJobs(html);

      expect(jobs.length, "expected parseAppleJobs to return at least one job").toBeGreaterThan(0);

      const result = AppleJobSchema.safeParse(jobs[0]);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    },
    TIMEOUT
  );
});

// ---------------------------------------------------------------------------
// Google  (HTML scraper — uses exported GoogleJobSchema + inline cheerio)
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

      const html = await res.text();
      const $ = cheerio.load(html);

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

      const rawJob = {
        role,
        company: jobCompany,
        location,
        link: `https://www.google.com/about/careers/applications/${href}`,
      };

      const result = GoogleJobSchema.safeParse(rawJob);
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
    "first job matches MetaJobSchema — needs getMetaSession exported to replicate GraphQL call"
  );
});

// ---------------------------------------------------------------------------
// Adobe  (auth-gated — verifies the session page loads and CSRF token is present)
// ---------------------------------------------------------------------------

describe("Adobe", () => {
  it(
    "careers page loads and contains CSRF token",
    async () => {
      const res = await fetch(AdobeCompany.page, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "accept-language": "en-US,en;q=0.9",
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
        },
      });

      expect(res.ok, `HTTP ${res.status}`).toBe(true);

      const html = await res.text();
      const csrfPattern =
        /"csrfToken"\s*:\s*"([^"]+)"|csrfToken["']?\s*[:=]\s*["']([^"']+)["']|name=["']csrfToken["']\s+value=["']([^"']+)["']/;

      expect(csrfPattern.test(html), "expected CSRF token to be present in page HTML").toBe(true);
    },
    TIMEOUT
  );

  it.todo(
    "first job matches AdobeJobSchema — needs getAdobeSession + ADOBE_WIDGETS_URL exported to replicate POST call"
  );
});

// Suppress unused import warning — schemas are referenced in .todo descriptions
void MetaJobSchema;
void AdobeJobSchema;
