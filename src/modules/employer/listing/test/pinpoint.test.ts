import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Titles from "@/modules/posting/titles";

vi.mock("@/modules/posting/titles", async (importOriginal) => {
  const actual = await importOriginal<typeof Titles>();
  return {
    ...actual,
    isTarget: vi.fn((title: string) => /engineer/i.test(title)),
  };
});

vi.mock("@/utils/data", () => ({ appendErrorLog: vi.fn() }));

import type { Company } from "@/types";

import { Employer } from "../../employer";
import { pinpointFetcher } from "../pinpoint";

import { appendErrorLog } from "@/utils/data";
import { toJobKeySet } from "@/utils/job-key";

const mockFetch = vi.fn<typeof fetch>();

const KNOWN = "11111111-1111-4111-8111-111111111111";
const FRESH = "22222222-2222-4222-8222-222222222222";
const REMOTE = "33333333-3333-4333-8333-333333333333";

const company: Company = {
  name: "Wolverine",
  ats: "pinpoint",
  identifier: "wolve",
  domain: "https://wolve.pinpointhq.com",
  page: "https://wolve.pinpointhq.com/postings.json",
  urls: [],
};

function posting(id: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    id: id.slice(0, 6),
    title,
    url: `https://careers.wolve.com/en/postings/${id}`,
    path: `/en/postings/${id}`,
    location: { name: "Chicago, IL" },
    workplace_type: "onsite",
    ...extra,
  };
}

describe("Pinpoint fetcher", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.mocked(appendErrorLog).mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("is a stateless singleton on the common contract", () => {
    expect(pinpointFetcher).toBeInstanceOf(Employer);
    expect(Object.keys(pinpointFetcher)).toEqual(["ats"]);
  });

  it("keys companies by tenant and names them from the careers page title", async () => {
    const url = new URL(`https://wolve.pinpointhq.com/en/postings/${KNOWN}?ats=pinpointhq`);
    mockFetch.mockResolvedValueOnce(
      new Response("<title>Jobs at Wolverine | Wolverine Careers</title>")
    );

    expect(pinpointFetcher.companyKeyFromUrl(url)).toBe("pinpoint:wolve");
    await expect(pinpointFetcher.formCompany(url)).resolves.toEqual(company);
  });

  it("returns unseen target postings on tenant-host links", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        data: [
          posting(KNOWN, "Software Engineer"),
          posting(FRESH, "Quant Engineer"),
          posting(REMOTE, "Platform Engineer", { location: null, workplace_type: "remote" }),
          posting("44444444-4444-4444-8444-444444444444", "Accountant"),
        ],
      })
    );

    const known = toJobKeySet([`https://wolve.pinpointhq.com/en/postings/${KNOWN}?ats=pinpointhq`]);

    await expect(pinpointFetcher.fetch(company, known, AbortSignal.timeout(1000))).resolves.toEqual(
      [
        {
          company: "Wolverine",
          role: "Quant Engineer",
          link: `https://wolve.pinpointhq.com/en/postings/${FRESH}`,
          location: "Chicago, IL",
        },
        {
          company: "Wolverine",
          role: "Platform Engineer",
          link: `https://wolve.pinpointhq.com/en/postings/${REMOTE}`,
          location: "Remote",
        },
      ]
    );
  });

  it("lists every posting for job keys", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({ data: [posting(KNOWN, "Accountant"), posting(FRESH, "Engineer")] })
    );

    await expect(pinpointFetcher.listJobKeys(company, AbortSignal.timeout(1000))).resolves.toEqual(
      new Set([`pinpoint:${KNOWN}`, `pinpoint:${FRESH}`])
    );
  });

  it("logs a missing board", async () => {
    mockFetch.mockResolvedValueOnce(new Response("", { status: 404, statusText: "Not Found" }));

    await expect(
      pinpointFetcher.fetch(company, new Set(), AbortSignal.timeout(1000))
    ).resolves.toEqual([]);
    expect(appendErrorLog).toHaveBeenCalledWith("Pinpoint: Wolverine - 404 - Not Found");
  });
});
