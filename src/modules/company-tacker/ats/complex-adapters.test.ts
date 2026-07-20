import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as CompanyUtils from "../utils";

vi.mock("../utils", async (importOriginal) => {
  const actual = await importOriginal<typeof CompanyUtils>();
  return { ...actual, isTarget: vi.fn(() => true) };
});

import type { Company } from "../type";

import { ATSFetcher } from "./class";
import { icimsFetcher } from "./icims";
import { phenomFetcher } from "./phenom";
import { workdayFetcher } from "./workday";

const mockFetch = vi.fn<typeof fetch>();

function response(body: string, url: string, headers?: HeadersInit): Response {
  const result = new Response(body, { headers });
  Object.defineProperty(result, "url", { value: url });
  return result;
}

function jsonResponse(data: unknown, url: string): Response {
  return response(JSON.stringify(data), url, { "content-type": "application/json" });
}

describe("complex ATS adapters", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("exposes stateless singleton fetchers through the common contract", () => {
    expect(workdayFetcher).toBeInstanceOf(ATSFetcher);
    expect(icimsFetcher).toBeInstanceOf(ATSFetcher);
    expect(phenomFetcher).toBeInstanceOf(ATSFetcher);
    expect(Object.keys(workdayFetcher)).toEqual(["ats"]);
    expect(Object.keys(icimsFetcher)).toEqual(["ats"]);
    expect(Object.keys(phenomFetcher)).toEqual(["ats"]);
  });

  it("keeps Workday pagination behavior without applying a within-days filter", async () => {
    const company: Company = {
      name: "acme",
      ats: "workday",
      identifier: "acme-external",
      domain: "https://acme.wd1.myworkdayjobs.com/en-US/external",
      page: "https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/external/jobs",
      urls: [],
    };
    const jobPostings = Array.from({ length: 20 }, (_, index) => ({
      title: `Software Engineer ${index}`,
      postedOn: "Posted 30+ Days Ago",
      locationsText: "Remote",
      externalPath: `/job/${index}`,
    }));

    mockFetch.mockResolvedValueOnce(jsonResponse({ jobPostings }, company.page));

    const jobs = await workdayFetcher.fetch(company, new Set(), AbortSignal.timeout(1000));

    expect(jobs).toHaveLength(20);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(mockFetch.mock.calls[0][1]?.body))).toMatchObject({
      limit: 20,
      offset: 0,
    });
  });

  it("parses iCIMS HTML without mutating the caller's URL set", async () => {
    const company: Company = {
      name: "acme",
      ats: "icims",
      identifier: "acme",
      domain: "https://careers-acme.icims.com",
      page: "https://careers-acme.icims.com/jobs/search",
      urls: [],
    };
    const urls = new Set(["https://careers-acme.icims.com/jobs/1/existing-job"]);
    const html = `
      <div class="iCIMS_JobsTable">
        <a href="/jobs/2/software-engineer/job?in_iframe=1">
          <h3>Software Engineer</h3>
          <span>US-CA-San Francisco</span>
        </a>
      </div>
    `;

    mockFetch.mockResolvedValueOnce(response(html, `${company.page}?pr=0`));

    const jobs = await icimsFetcher.fetch(company, urls, AbortSignal.timeout(1000));

    expect(jobs).toEqual([
      {
        company: "Acme",
        role: "Software Engineer",
        link: "https://careers-acme.icims.com/jobs/2/software-engineer/job",
        location: "US-CA-San Francisco",
      },
    ]);
    expect([...urls]).toEqual(["https://careers-acme.icims.com/jobs/1/existing-job"]);
  });

  it("isolates concurrent Phenom sessions, cookies, CSRF tokens, and links", async () => {
    const companies: Company[] = ["alpha", "beta"].map((name) => ({
      name,
      ats: "phenom",
      identifier: name,
      domain: `https://${name}.example`,
      page: `https://${name}.example`,
      urls: [],
    }));
    const widgetRequests: Array<{ url: string; csrf: string | null; cookie: string | null }> = [];

    mockFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      const host = new URL(url).hostname.split(".")[0];

      if (!url.endsWith("/widgets")) {
        return response(
          `<script>{"csrfToken":"token-${host}","companyName":"${host.toUpperCase()}"}</script>`,
          url,
          { "set-cookie": `session=${host}; Path=/; HttpOnly` }
        );
      }

      const headers = new Headers(init?.headers);
      widgetRequests.push({
        url,
        csrf: headers.get("x-csrf-token"),
        cookie: headers.get("cookie"),
      });

      return jsonResponse(
        {
          refineSearch: {
            data: {
              jobs: [
                {
                  jobId: `${host}-job`,
                  title: "Software Engineer",
                  postedDate: new Date().toISOString(),
                  location: "Remote",
                },
              ],
            },
          },
        },
        url
      );
    });

    const [alphaJobs, betaJobs] = await Promise.all(
      companies.map((company) => phenomFetcher.fetch(company, new Set(), AbortSignal.timeout(1000)))
    );

    expect(alphaJobs[0]).toMatchObject({
      company: "ALPHA",
      link: "https://alpha.example/job/alpha-job?ph_id=alpha-job",
    });
    expect(betaJobs[0]).toMatchObject({
      company: "BETA",
      link: "https://beta.example/job/beta-job?ph_id=beta-job",
    });
    expect(widgetRequests).toEqual(
      expect.arrayContaining([
        {
          url: "https://alpha.example/widgets",
          csrf: "token-alpha",
          cookie: "session=alpha",
        },
        {
          url: "https://beta.example/widgets",
          csrf: "token-beta",
          cookie: "session=beta",
        },
      ])
    );
  });
});
