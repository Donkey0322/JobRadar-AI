import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Titles from "@/modules/posting/titles";

vi.mock("@/modules/posting/titles", async (importOriginal) => {
  const actual = await importOriginal<typeof Titles>();
  return {
    ...actual,
    isTarget: vi.fn((title: string) => /engineer/i.test(title)),
    withinDays: vi.fn((date: unknown) => date === "recent" || date === 1_700_000_000),
  };
});

vi.mock("@/store", () => ({ errorLog: { append: vi.fn() } }));

import { AmazonCompany,fetchAmazon } from "../amazon";
import { AppleCompany,fetchApple } from "../apple";
import { ByteDanceCompany,fetchByteDance } from "../bytedance";
import { fetchGoogle, GoogleCompany } from "../google";
import { fetchMeta, MetaCompany } from "../meta";
import { fetchNetflix, NetflixCompany } from "../netflix";
import { fetchTikTok, TikTokCompany } from "../tiktok";

import { toJobKeySet } from "@/modules/ats/job-key";

const mockFetch = vi.fn<typeof fetch>();
const signal = AbortSignal.timeout(1000);

function appleCard(id: string, title: string, postedAt: string): string {
  return `
    <li>
      <a href="/en-us/details/${id}/${title.toLowerCase().replaceAll(" ", "-")}">${title}</a>
      <span class="job-title-location">Cupertino</span>
      <span class="job-posted-date">${postedAt}</span>
    </li>
  `;
}

function googleCard(id: string, role: string): string {
  return `
    <div>
      <h3>${role}</h3>
      <p>Google | Mountain View</p>
      <a href="jobs/results/${id}-${role.toLowerCase().replaceAll(" ", "-")}">${role}</a>
    </div>
  `;
}

describe("custom boards drop known jobs on the final link", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("keeps Amazon order and makes one request", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        searchHits: [
          { fields: hit("111", "Platform Engineer", "recent") },
          { fields: hit("222", "Accountant", "recent") },
          { fields: hit("333", "Known Engineer", "recent") },
          { fields: hit("444", "Old Engineer", "old") },
          { fields: hit("555", "Quant Engineer", "recent") },
        ],
      })
    );

    const jobs = await fetchAmazon(
      AmazonCompany,
      toJobKeySet(["https://amazon.jobs/en/jobs/333?src=1"]),
      signal
    );

    expect(jobs.map((job) => job.link)).toEqual([
      "https://amazon.jobs/en/jobs/111",
      "https://amazon.jobs/en/jobs/555",
    ]);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("keeps Google order and stops on the empty next page", async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(
          `<html>${googleCard("111", "Platform Engineer")}${googleCard("222", "Accountant")}${googleCard("333", "Known Engineer")}${googleCard("444", "Quant Engineer")}</html>`
        )
      )
      .mockResolvedValueOnce(new Response("<html></html>"));

    const jobs = await fetchGoogle(
      GoogleCompany,
      toJobKeySet([
        "https://www.google.com/about/careers/applications/jobs/results/333-known-engineer",
      ]),
      signal
    );

    expect(jobs.map((job) => job.link)).toEqual([
      "https://www.google.com/about/careers/applications/jobs/results/111-platform-engineer",
      "https://www.google.com/about/careers/applications/jobs/results/444-quant-engineer",
    ]);
    expect(mockFetch.mock.calls.map((call) => String(call[0]))).toEqual([
      "https://www.google.com/about/careers/applications/jobs/results?sort_by=date&page=1",
      "https://www.google.com/about/careers/applications/jobs/results?sort_by=date&page=2",
    ]);
  });

  it("keeps Apple order and stops when the next page has no recent jobs", async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(
          `<ul id="search-job-list">${appleCard("200-111111", "Platform Engineer", "recent")}${appleCard("200-222222", "Known Engineer", "recent")}${appleCard("200-333333", "Quant Engineer", "recent")}</ul>`
        )
      )
      .mockResolvedValueOnce(
        new Response(
          `<ul id="search-job-list">${appleCard("200-444444", "Old Engineer", "old")}</ul>`
        )
      );

    const jobs = await fetchApple(
      AppleCompany,
      toJobKeySet(["https://jobs.apple.com/en-us/details/200-222222/known-engineer"]),
      signal
    );

    expect(jobs.map((job) => job.role)).toEqual(["Platform Engineer", "Quant Engineer"]);
    expect(jobs.map((job) => job.link)).toEqual([
      "https://jobs.apple.com/en-us/details/200-111111/platform-engineer",
      "https://jobs.apple.com/en-us/details/200-333333/quant-engineer",
    ]);
    expect(mockFetch.mock.calls.map((call) => String(call[0]))).toEqual([
      "https://jobs.apple.com/en-us/search?sort=newest&page=1",
      "https://jobs.apple.com/en-us/search?sort=newest&page=2",
    ]);
  });

  it("keeps Meta order after the session and one search", async () => {
    mockFetch
      .mockResolvedValueOnce(sessionPage())
      .mockResolvedValueOnce(
        new Response(
          `for (;;);${JSON.stringify({
            data: {
              job_search_with_featured_jobs: {
                all_jobs: [
                  { id: "111", title: "Platform Engineer", locations: ["Menlo Park"] },
                  { id: "222", title: "Recruiter", locations: ["New York"] },
                  { id: "333", title: "Known Engineer", locations: ["Seattle"] },
                  { id: "444", title: "Quant Engineer", locations: ["Remote"] },
                ],
              },
            },
          })}`
        )
      );

    const jobs = await fetchMeta(
      MetaCompany,
      toJobKeySet(["https://www.metacareers.com/profile/job_details/333"]),
      signal
    );

    expect(jobs.map((job) => job.link)).toEqual([
      "https://www.metacareers.com/profile/job_details/111",
      "https://www.metacareers.com/profile/job_details/444",
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("keeps Netflix order and still requests the empty next page", async () => {
    mockFetch
      .mockResolvedValueOnce(
        Response.json({
          positions: [
            position(111, "Platform Engineer", 1_700_000_000),
            position(222, "Known Engineer", 1_700_000_000),
            position(333, "Old Engineer", 1),
            position(444, "Quant Engineer", 1_700_000_000),
          ],
        })
      )
      .mockResolvedValueOnce(Response.json({ positions: [] }));

    const jobs = await fetchNetflix(
      NetflixCompany,
      toJobKeySet(["https://explore.jobs.netflix.net/careers/job/222?src=1"]),
      signal
    );

    expect(jobs.map((job) => job.link)).toEqual([
      "https://explore.jobs.netflix.net/careers/job/111",
      "https://explore.jobs.netflix.net/careers/job/444",
    ]);
    expect(mockFetch.mock.calls.map((call) => String(call[0]))).toEqual([
      "https://explore.jobs.netflix.net/api/apply/v2/jobs?sort_by=new&num=100",
      "https://explore.jobs.netflix.net/api/apply/v2/jobs?sort_by=new&num=100&start=100",
    ]);
  });

  it("keeps TikTok order in one request", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        code: 0,
        data: {
          job_post_list: [
            post("111", "Platform Engineer"),
            post("222", "Accountant"),
            post("333", "Known Engineer"),
            post("444", "Quant Engineer"),
          ],
        },
      })
    );

    const jobs = await fetchTikTok(
      TikTokCompany,
      toJobKeySet(["https://lifeattiktok.com/search/333"]),
      signal
    );

    expect(jobs.map((job) => job.link)).toEqual([
      "https://lifeattiktok.com/search/111",
      "https://lifeattiktok.com/search/444",
    ]);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("keeps ByteDance order and stops on a short page", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        code: 0,
        data: {
          count: 4,
          job_post_list: [
            post("111", "Platform Engineer"),
            post("222", "Accountant"),
            post("333", "Known Engineer"),
            post("444", "Quant Engineer"),
          ],
        },
      })
    );

    const jobs = await fetchByteDance(
      ByteDanceCompany,
      toJobKeySet(["https://joinbytedance.com/search/333"]),
      signal
    );

    expect(jobs.map((job) => job.link)).toEqual([
      "https://joinbytedance.com/search/111",
      "https://joinbytedance.com/search/444",
    ]);
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});

function hit(id: string, title: string, date: string) {
  return {
    title: [title],
    location: ["Seattle, WA"],
    createdDate: [date],
    updatedDate: [date],
    icimsJobId: [id],
  };
}

function post(id: string, title: string) {
  return { id, title, city_info: { en_name: "San Jose" } };
}

function position(id: number, name: string, created: number) {
  return {
    id,
    posting_name: name,
    location: "Los Gatos, California",
    canonicalPositionUrl: `https://explore.jobs.netflix.net/careers/job/${id}`,
    t_create: created,
    t_update: created,
  };
}

function sessionPage(): Response {
  const headers = new Headers();
  headers.append("set-cookie", "datr=d1; Path=/; Secure");
  return new Response(`<html><script>["LSD",[],{"token":"abc"}]</script></html>`, {
    status: 200,
    headers,
  });
}
