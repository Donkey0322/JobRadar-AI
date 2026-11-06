import { afterEach, describe, expect, it, vi } from "vitest";

import type * as Store from "@/store";

vi.mock("@/store", async (importOriginal) => {
  const actual = await importOriginal<typeof Store>();
  return { ...actual, errorLog: { ...actual.errorLog, append: vi.fn(async () => undefined) } };
});

import { AppleCompany, fetchApple, parseAppleJobs } from "../apple";

import { getJobKey } from "@/modules/ats/job-key";
import { checkUrlsAgainstListing } from "@/modules/employer/liveness";

function appleCard(id: string, title: string, postedAt: string) {
  return `<li><a href="/en-us/details/${id}/role">${title}</a><span class="job-posted-date">${postedAt}</span></li>`;
}

function appleHtml(cards: string) {
  return `<ul id="search-job-list">${cards}</ul>`;
}

function appleResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { "content-type": "text/html" },
  });
}

function pageOf(input: RequestInfo | URL): string {
  const url = new URL(String(input));
  return url.searchParams.get("page") ?? "";
}

describe("parseAppleJobs", () => {
  it("normalizes whitespace in parsed text fields", () => {
    const postedAt = new Date().toISOString();
    const html = `
      <ul id="search-job-list">
        <li>
          <a href="/en-us/details/123/software-engineer">
            Software
            Engineer
          </a>
          <span class="table--advanced-search__location-sub">Cupertino   CA</span>
          <span class="job-posted-date">${postedAt}</span>
        </li>
      </ul>
    `;

    expect(parseAppleJobs(html)).toEqual([
      {
        title: "Software Engineer",
        link: "https://jobs.apple.com/en-us/details/123/software-engineer",
        location: "Cupertino CA",
        postedAt,
      },
    ]);
  });

  it("reads a single office from the location column and ignores the accessibility label", () => {
    const html = `
      <ul id="search-job-list">
        <li>
          <a href="/en-us/details/200689475-2611/software-development-engineer-core-os">
            Software Development Engineer - Core OS
          </a>
          <div class="job-title-location">
            <span class="a11y">Location</span>
            <span id="search-store-name-container-1">Prague</span>
          </div>
          <span class="job-posted-date">Oct 20, 2026</span>
        </li>
        <li>
          <a href="/en-us/details/114438210/jp-technical-specialist">JP-Technical Specialist</a>
          <div class="job-title-location">
            <span class="a11y">Location</span>
            <span class="table--advanced-search__location-sub">Various Locations within Japan</span>
          </div>
          <span class="job-posted-date">Oct 25, 2026</span>
        </li>
      </ul>
    `;

    expect(parseAppleJobs(html).map((job) => job.location)).toEqual([
      "Prague",
      "Various Locations within Japan",
    ]);
  });
});

describe("Apple listing liveness", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("confirms a stored URL from the first page and does not request the next page", async () => {
    const stored = "https://jobs.apple.com/en-us/details/200670523-0836/old-slug?team=SFTWR";
    const pages: string[] = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const page = pageOf(input);
      pages.push(page);
      if (page !== "1") throw new Error(`unexpected page ${page}`);
      return Promise.resolve(
        appleResponse(appleHtml(appleCard("200670523-0836", "Software Engineer Intern", "Jan 1, 2020")))
      );
    });

    const result = await checkUrlsAgainstListing(AppleCompany, [stored], AbortSignal.timeout(1_000), {
      onPage: () => undefined,
    });

    expect(pages).toEqual(["1"]);
    expect(result.listed).toEqual([stored]);
    expect(result.unverified).toEqual([]);
    expect(getJobKey(stored)).toBe("apple:200670523-0836");
  });

  it("stops once a later page contains every remaining target", async () => {
    const first = "https://jobs.apple.com/en-us/details/111111111/role";
    const second = "https://jobs.apple.com/en-us/details/222222222/role?team=SFTWR";
    const pages: string[] = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const page = pageOf(input);
      pages.push(page);
      if (page === "1") {
        return Promise.resolve(appleResponse(appleHtml(appleCard("111111111", "Role", "Jan 1, 2020"))));
      }
      if (page === "2") {
        return Promise.resolve(appleResponse(appleHtml(appleCard("222222222", "Role", "Jan 1, 2020"))));
      }
      throw new Error(`unexpected page ${page}`);
    });

    const result = await checkUrlsAgainstListing(
      AppleCompany,
      [first, second],
      AbortSignal.timeout(1_000)
    );

    expect(pages).toEqual(["1", "2"]);
    expect(result.listed).toEqual([first, second]);
    expect(result.unverified).toEqual([]);
  });

  it("keeps an earlier hit when a later page fails or does not parse", async () => {
    const found = "https://jobs.apple.com/en-us/details/111111111/role";
    const missing = "https://jobs.apple.com/en-us/details/333333333/role";
    const pages: string[] = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const page = pageOf(input);
      pages.push(page);
      if (page === "1") {
        return Promise.resolve(appleResponse(appleHtml(appleCard("111111111", "Role", "Jan 1, 2020"))));
      }
      if (page === "2") return Promise.resolve(appleResponse("<html>not a job list</html>"));
      throw new Error(`unexpected page ${page}`);
    });

    const parsed = await checkUrlsAgainstListing(
      AppleCompany,
      [found, missing],
      AbortSignal.timeout(1_000)
    );
    expect(pages).toEqual(["1", "2"]);
    expect(parsed).toEqual({ listed: [found], unverified: [missing] });

    pages.length = 0;
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const page = pageOf(input);
      pages.push(page);
      if (page === "1") {
        return Promise.resolve(appleResponse(appleHtml(appleCard("111111111", "Role", "Jan 1, 2020"))));
      }
      if (page === "2") return Promise.resolve(appleResponse("", 500));
      throw new Error(`unexpected page ${page}`);
    });

    const failed = await checkUrlsAgainstListing(
      AppleCompany,
      [found, missing],
      AbortSignal.timeout(1_000)
    );
    expect(pages).toEqual(["1", "2"]);
    expect(failed).toEqual({ listed: [found], unverified: [missing] });
  });

  it("does not request a page past the listing cap", async () => {
    const stored = "https://jobs.apple.com/en-us/details/999999999/role";
    const pages: string[] = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const page = pageOf(input);
      pages.push(page);
      return Promise.resolve(appleResponse(appleHtml(appleCard(String(1000 + Number(page)), "Role", "Jan 1, 2020"))));
    });

    const result = await checkUrlsAgainstListing(AppleCompany, [stored], AbortSignal.timeout(1_000));

    expect(pages).toEqual(Array.from({ length: 20 }, (_, index) => String(index + 1)));
    expect(result).toEqual({ listed: [], unverified: [stored] });
  });

  it("keeps discovery recency and title filters and still reads the next recent page", async () => {
    const recent = new Date().toISOString();
    const known = "https://jobs.apple.com/en-us/details/111111111/role";
    const fresh = "https://jobs.apple.com/en-us/details/444444444/role";
    const pages: string[] = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const page = pageOf(input);
      pages.push(page);
      const url = new URL(String(input));
      expect(url.searchParams.get("sort")).toBe("newest");
      if (page === "1") {
        return Promise.resolve(
          appleResponse(
            appleHtml(
              [
                appleCard("111111111", "Software Engineer Intern", recent),
                appleCard("222222222", "Software Engineer Intern", "2020-01-01"),
                appleCard("333333333", "Retail Specialist", recent),
              ].join("")
            )
          )
        );
      }
      if (page === "2") {
        return Promise.resolve(
          appleResponse(appleHtml(appleCard("444444444", "Software Engineer Intern", recent)))
        );
      }
      if (page === "3") return Promise.resolve(appleResponse(appleHtml("")));
      throw new Error(`unexpected page ${page}`);
    });

    const jobs = await fetchApple(AppleCompany, new Set([getJobKey(known)]));

    expect(pages).toEqual(["1", "2", "3"]);
    expect(jobs.map((job) => job.link)).toEqual([fresh]);
  });
});
