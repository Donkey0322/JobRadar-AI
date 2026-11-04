import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Titles from "@/modules/posting/titles";

vi.mock("@/modules/posting/titles", async (importOriginal) => {
  const actual = await importOriginal<typeof Titles>();
  return { ...actual, isTarget: vi.fn(() => true), withinDays: vi.fn(() => true) };
});

const appendErrorLog = vi.hoisted(() => vi.fn());
vi.mock("@/store", () => ({ errorLog: { append: appendErrorLog } }));

import type { Company } from "@/types";

import { Employer } from "../../employer";
import { successFactorsFetcher } from "../successfactors";

import { toJobKeySet } from "@/modules/ats/job-key";

const mockFetch = vi.fn<typeof fetch>();

function feed(items: string, name = "Aramark"): Response {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8" ?><rss version='2.0'><channel>
      <description>Custom RSS Feed for ${name}</description>${items}
    </channel></rss>`,
    { headers: { "content-type": "application/rss+xml" } }
  );
}

function item(title: string, path: string): string {
  return `<item>
    <title><![CDATA[${title}]]></title>
    <pubDate>Mon, 02 Nov 2026 8:00:00 GMT</pubDate>
    <link>https://aramarkcareers.com${path}?feedId=null&amp;utm_source=J2WRSS</link>
  </item>`;
}

const company: Company = {
  name: "Aramark",
  ats: "successfactors",
  identifier: "aramarkcareers.com",
  domain: "https://aramarkcareers.com",
  page: "https://aramarkcareers.com/services/rss/job/?locale=en_US",
  urls: [],
};

describe("SuccessFactors fetcher", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("is a stateless singleton on the common contract", () => {
    expect(successFactorsFetcher).toBeInstanceOf(Employer);
    expect(Object.keys(successFactorsFetcher)).toEqual(["ats"]);
  });

  it("forms a company from a job URL and names it from the feed", async () => {
    const url = new URL(
      "https://aramarkcareers.com/UnitedStates/job/West-Allis-Food-Service-Worker-WI-53227/1441993400/"
    );
    mockFetch.mockResolvedValueOnce(feed(""));

    expect(successFactorsFetcher.companyKeyFromUrl(url)).toBe("successfactors:aramarkcareers.com");
    await expect(successFactorsFetcher.formCompany(url)).resolves.toEqual(company);
    expect(String(mockFetch.mock.calls[0][0])).toBe(company.page);
  });

  it("falls back to the host name when the feed cannot be read", async () => {
    mockFetch.mockRejectedValueOnce(new Error("offline"));

    await expect(
      successFactorsFetcher.formCompany(
        new URL("https://careers.qorvo.com/job/X-TX-75080/1435014200/")
      )
    ).resolves.toMatchObject({ name: "careers.qorvo.com", identifier: "careers.qorvo.com" });
  });

  it("returns new feed postings with clean links and skips known jobs", async () => {
    const knownKeys = toJobKeySet([
      "https://aramarkcareers.com/UnitedStates/job/Rockville-Data-Engineer-MD-20850/1426145000/?ats=successfactors",
    ]);
    mockFetch.mockResolvedValueOnce(
      feed(
        item(
          "Jr. Data Engineer (Rockville, MD, US, 20850)",
          "/UnitedStates/job/Rockville-Data-Engineer-MD-20850/1426145000/"
        ) +
          item(
            "Software Engineer (Philadelphia, PA, US, 19107)",
            "/UnitedStates/job/Philadelphia-Software-Engineer-PA-19107/1446000000/"
          )
      )
    );

    const jobs = await successFactorsFetcher.fetch(company, knownKeys, AbortSignal.timeout(1000));

    expect(jobs).toEqual([
      {
        company: "Aramark",
        role: "Software Engineer",
        link: "https://aramarkcareers.com/UnitedStates/job/Philadelphia-Software-Engineer-PA-19107/1446000000/",
        location: "Philadelphia, PA, US, 19107",
      },
    ]);
  });

  it("lists every feed job key for liveness checks", async () => {
    mockFetch.mockResolvedValueOnce(
      feed(
        item("Cook (Austin, TX, US, 78701)", "/UnitedStates/job/Austin-Cook-TX-78701/1440000000/")
      )
    );

    await expect(
      successFactorsFetcher.listJobKeys(company, AbortSignal.timeout(1000))
    ).resolves.toEqual(new Set(["successfactors:aramarkcareers.com:1440000000"]));
  });

  it("logs a dead career domain in one line instead of throwing", async () => {
    mockFetch.mockRejectedValueOnce(
      new TypeError("fetch failed", { cause: new Error("certificate has expired") })
    );

    await expect(
      successFactorsFetcher.fetch(company, new Set(), AbortSignal.timeout(1000))
    ).resolves.toEqual([]);
    expect(appendErrorLog).toHaveBeenCalledWith(
      "SuccessFactors: Aramark - certificate has expired"
    );
  });

  it("returns nothing when the feed request fails", async () => {
    mockFetch.mockResolvedValueOnce(new Response("", { status: 503 }));

    await expect(
      successFactorsFetcher.fetch(company, new Set(), AbortSignal.timeout(1000))
    ).resolves.toEqual([]);
  });
});
