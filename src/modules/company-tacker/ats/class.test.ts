import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils", () => ({
  isTarget: vi.fn(() => true),
  withinDays: vi.fn(() => true),
}));

import type { Company } from "../type";

import { ashbyFetcher } from "./ashby";
import { ATSFetcher } from "./class";
import { eightfoldFetcher } from "./eightfold";
import { greenhouseFetcher } from "./greenhouse";
import { leverFetcher } from "./lever";
import { oracleCloudFetcher } from "./oraclecloud";
import { smartRecruitersFetcher } from "./smart";

const mockFetch = vi.fn<typeof fetch>();

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  });
}

describe("ATSFetcher pilot adapters", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("exposes Greenhouse and Eightfold through the common base contract", () => {
    expect(greenhouseFetcher).toBeInstanceOf(ATSFetcher);
    expect(greenhouseFetcher.ats).toBe("greenhouse");
    expect(eightfoldFetcher).toBeInstanceOf(ATSFetcher);
    expect(eightfoldFetcher.ats).toBe("eightfold");
  });

  it("exposes the simple adapters through the common base contract", () => {
    expect(ashbyFetcher).toBeInstanceOf(ATSFetcher);
    expect(ashbyFetcher.ats).toBe("ashby");
    expect(leverFetcher).toBeInstanceOf(ATSFetcher);
    expect(leverFetcher.ats).toBe("lever");
    expect(oracleCloudFetcher).toBeInstanceOf(ATSFetcher);
    expect(oracleCloudFetcher.ats).toBe("oraclecloud");
    expect(smartRecruitersFetcher).toBeInstanceOf(ATSFetcher);
    expect(smartRecruitersFetcher.ats).toBe("smartrecruiters");
  });

  it("keeps Greenhouse company formation compatible", async () => {
    const company = await greenhouseFetcher.formCompany(
      new URL("https://job-boards.greenhouse.io/acme/jobs/123")
    );

    expect(company).toEqual({
      name: "acme",
      ats: "greenhouse",
      identifier: "acme",
      domain: "https://job-boards.greenhouse.io",
      page: "https://boards-api.greenhouse.io/v1/boards/acme/jobs",
      urls: [],
    });
  });

  it("parses, filters, and normalizes Greenhouse jobs", async () => {
    const company: Company = {
      name: "acme",
      ats: "greenhouse",
      identifier: "acme",
      domain: "https://acme.example",
      page: "https://boards-api.greenhouse.io/v1/boards/acme/jobs",
      urls: [],
    };
    const duplicateUrl = "https://boards.greenhouse.io/acme/jobs/1";

    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        jobs: [
          {
            title: "Software Engineer",
            absolute_url: duplicateUrl,
            updated_at: new Date().toISOString(),
          },
          {
            company_name: "Acme Inc.",
            title: "Platform Engineer",
            absolute_url: "https://boards.greenhouse.io/acme/jobs/2",
            updated_at: new Date().toISOString(),
            location: { name: "Remote" },
          },
        ],
      })
    );

    await expect(
      greenhouseFetcher.fetch(company, new Set([duplicateUrl]), AbortSignal.timeout(1000))
    ).resolves.toEqual([
      {
        company: "Acme Inc.",
        role: "Platform Engineer",
        link: "https://boards.greenhouse.io/acme/jobs/2",
        location: "Remote",
      },
    ]);
  });

  it("keeps Eightfold company formation compatible with Apply fallback", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ message: "PCSX is not enabled for this user." })
    );

    const company = await eightfoldFetcher.formCompany(
      new URL("https://acme.eightfold.ai/careers?domain=jobs.acme.com")
    );

    expect(company).toEqual({
      name: "acme",
      ats: "eightfold",
      identifier: "acme",
      domain: "jobs.acme.com",
      page: "https://acme.eightfold.ai/api/apply/v2/jobs?domain=jobs.acme.com",
      urls: [],
    });
  });

  it("normalizes the Eightfold Apply format and stops on a short page", async () => {
    const company: Company = {
      name: "acme",
      ats: "eightfold",
      identifier: "acme",
      domain: "jobs.acme.com",
      page: "https://acme.eightfold.ai/api/apply/v2/jobs?domain=jobs.acme.com",
      urls: [],
    };
    const now = Date.now();

    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        positions: [
          {
            id: 42,
            name: "Software Engineer",
            locations: ["New York", "Remote"],
            t_create: now,
            canonicalPositionUrl: "https://acme.eightfold.ai/careers/job/42",
          },
        ],
      })
    );

    const jobs = await eightfoldFetcher.fetch(
      company,
      new Set(),
      AbortSignal.timeout(1000)
    );

    expect(jobs).toEqual([
      {
        company: "Acme",
        role: "Software Engineer",
        link: "https://acme.eightfold.ai/careers/job/42?domain=jobs.acme.com&8fold_id=42",
        location: "New York, Remote",
      },
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("continues Eightfold pagination for a full PCSX page and stops on empty data", async () => {
    const company: Company = {
      name: "acme",
      ats: "eightfold",
      identifier: "acme",
      domain: "jobs.acme.com",
      page: "https://acme.eightfold.ai/api/pcsx/search?domain=jobs.acme.com",
      urls: [],
    };
    const now = Date.now();
    const positions = Array.from({ length: 10 }, (_, index) => ({
      id: index + 1,
      name: `Engineer ${index + 1}`,
      locations: ["Remote"],
      creationTs: now,
      postedTs: now,
      positionUrl: `/careers/job/${index + 1}`,
    }));

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: { positions } }))
      .mockResolvedValueOnce(jsonResponse({ data: { positions: [] } }));

    const jobs = await eightfoldFetcher.fetch(
      company,
      new Set(),
      AbortSignal.timeout(1000)
    );

    expect(jobs).toHaveLength(10);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(String(mockFetch.mock.calls[1][0])).toContain("start=10");
  });
});
