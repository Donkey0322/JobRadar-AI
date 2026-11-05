import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Job } from "@/types";

import { Board } from "../../../employer";

const { fetchAmazonMock } = vi.hoisted(() => ({
  fetchAmazonMock: vi.fn(),
}));

vi.mock("../amazon", () => ({
  AmazonCompany: {
    name: "Amazon",
    ats: "custom",
    identifier: "amazon",
    domain: "https://amazon.jobs",
    page: "https://amazon.jobs/api/jobs/search?is_als=true",
    urls: [],
  },
  fetchAmazon: fetchAmazonMock,
}));

import { customBoard } from "../index";

describe("CustomBoard", () => {
  beforeEach(() => {
    fetchAmazonMock.mockReset();
  });

  it("forms and dispatches a known custom company", async () => {
    const company = customBoard.formCompany(new URL("https://www.amazon.jobs/en/"));
    const jobs: Job[] = [
      {
        company: "Amazon",
        role: "Software Engineer",
        link: "https://amazon.jobs/en/jobs/123",
        location: "Seattle, WA",
      },
    ];
    const urls = new Set<string>();
    const signal = AbortSignal.timeout(1000);

    fetchAmazonMock.mockResolvedValueOnce(jobs);

    expect(customBoard).toBeInstanceOf(Board);
    expect(customBoard.ats).toBe("custom");
    expect(company.identifier).toBe("amazon");
    await expect(customBoard.fetch(company, urls, signal)).resolves.toBe(jobs);
    expect(fetchAmazonMock).toHaveBeenCalledWith(company, urls, signal);
  });

  it("forms ByteDance from both career hosts", () => {
    const fromSearch = customBoard.formCompany(new URL("https://joinbytedance.com/search/1"));
    const fromDetail = customBoard.formCompany(
      new URL("https://jobs.bytedance.com/en/position/1/detail")
    );

    expect(fromSearch).toMatchObject({
      name: "ByteDance",
      identifier: "bytedance",
      page: "https://jobs.bytedance.com/api/v1/public/supplier/search/job/posts",
    });
    expect(fromDetail.identifier).toBe("bytedance");
    expect(fromDetail.page).toBe(fromSearch.page);
  });

  it("forms a fallback company and skips its empty page", async () => {
    const company = customBoard.formCompany(new URL("https://www.example.com/careers"));

    expect(company).toEqual({
      name: "example.com",
      ats: "custom",
      identifier: "example.com",
      domain: "https://www.example.com",
      page: "",
      urls: [],
    });
    await expect(
      customBoard.fetch(company, new Set(), AbortSignal.timeout(1000))
    ).resolves.toEqual([]);
    expect(fetchAmazonMock).not.toHaveBeenCalled();
  });

  it("returns nothing for an unknown custom page without requesting it", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const company = {
      ...customBoard.formCompany(new URL("https://www.example.com/careers")),
      page: "https://www.example.com/careers",
    };

    await expect(customBoard.fetch(company, new Set(), AbortSignal.timeout(1000))).resolves.toEqual(
      []
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fetchAmazonMock).not.toHaveBeenCalled();
  });
});
