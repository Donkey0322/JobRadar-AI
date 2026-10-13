import z from "zod";

import { RED_CROSS } from "@/constants/log";

import type { Company, Job } from "@/types";

import { Employer } from "../employer";

import {
  getRadancyCompanyName,
  getRadancyResultsPostUrl,
  parseRadancyJobs,
} from "@/modules/employer/shared/radancy";
import { appendErrorLog } from "@/utils/data";
import { isAbortError } from "@/utils/http";
import { logger } from "@/utils/logger";
import { capitalize } from "@/utils/string";
import { getHostnameWithoutWww } from "@/utils/url";

export const RadancyJobSchema = z.object({
  jobId: z.string(),
  title: z.string(),
  link: z.string(),
  location: z.string(),
});

export type RadancyJob = z.infer<typeof RadancyJobSchema>;

export const RadancyResponseSchema = z.object({
  results: z.string(),
  hasJobs: z.boolean().optional(),
});

const PAGE_SIZE = 50;
const MAX_PAGES = 3;

const DATE_POSTED_SORT = {
  SortCriteria: 1,
  SortDirection: 1,
} as const;

function radancyHeaders(pageUrl: string): HeadersInit {
  return {
    accept: "application/json, text/javascript, */*; q=0.01",
    "content-type": "application/json; charset=utf-8",
    referer: pageUrl.replace(/\/resultspost\/?$/, ""),
    "x-requested-with": "XMLHttpRequest",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
  };
}

/** Keep the listing path when a board 301s to another origin's homepage. */
function listingUrlAfterRedirect(from: string, location: string): string | null {
  let next: URL;

  try {
    next = new URL(location, from);
  } catch {
    return null;
  }

  const current = new URL(from);
  const nextPath = next.pathname.replace(/\/$/, "");

  if (nextPath.endsWith("/search-jobs/resultspost")) {
    return next.toString();
  }

  if (next.origin === current.origin) return null;

  return `${next.origin}${current.pathname}${current.search}`;
}

function companyForListing(company: Company, responseUrl: string): Company {
  if (!responseUrl) return company;

  try {
    const origin = new URL(responseUrl).origin;
    if (origin === new URL(company.domain).origin) return company;
    return { ...company, domain: origin };
  } catch {
    return company;
  }
}

async function postRadancyPage(url: string, page: number, signal: AbortSignal): Promise<Response> {
  const request = (target: string) =>
    fetch(target, {
      method: "POST",
      redirect: "manual",
      signal,
      headers: radancyHeaders(target),
      body: JSON.stringify(createRadancyRequestBody(page)),
    });

  const response = await request(url);
  if (response.status < 300 || response.status >= 400) return response;

  const location = response.headers.get("location");
  if (!location) return response;

  const retryUrl = listingUrlAfterRedirect(url, location);
  if (!retryUrl || retryUrl === url) return response;

  return request(retryUrl);
}

function createRadancyRequestBody(page: number) {
  return {
    ActiveFacetID: 0,
    CurrentPage: page,
    RecordsPerPage: PAGE_SIZE,
    Distance: 50,
    RadiusUnitType: 0,
    Keywords: "",
    Location: "",
    Latitude: null,
    Longitude: null,
    ShowRadius: false,
    IsPagination: page > 1 ? "True" : "False",
    CustomFacetName: "",
    FacetTerm: "",
    FacetType: 0,
    FacetFilters: [],
    SearchResultsModuleName: "Search Results",
    SearchFiltersModuleName: "Search Filters",
    SearchType: 5,
    CategoryFacetTerm: "",
    CategoryFacetType: 0,
    LocationFacetTerm: "",
    LocationFacetType: 0,
    KeywordType: "",
    LocationType: "",
    LocationPath: "",
    OrganizationIds: "",
    RefinedKeywords: [],
    PostalCode: "",
    ResultsType: 0,
    ...DATE_POSTED_SORT,
  };
}

export class RadancyFetcher extends Employer<RadancyJob> {
  readonly ats = "radancy" as const;

  companyKeyFromUrl(url: URL): string {
    return this.companyKey(getHostnameWithoutWww(url));
  }

  formCompany(url: URL): Company {
    const identifier = getHostnameWithoutWww(url);

    return {
      name: getRadancyCompanyName(url),
      ats: this.ats,
      identifier,
      domain: url.origin,
      page: getRadancyResultsPostUrl(url),
      urls: [],
    };
  }

  protected getJobsFromResponse(data: unknown, company?: Company): RadancyJob[] {
    const parsed = RadancyResponseSchema.safeParse(data);

    if (!parsed.success) {
      logger.error(
        {
          company: company?.name,
          issues: parsed.error.issues,
        },
        `${RED_CROSS} Invalid Radancy response`
      );

      return [];
    }

    const baseUrl = company?.domain ?? "https://example.com";
    return parseRadancyJobs(parsed.data.results, baseUrl);
  }

  protected getJobLink(job: RadancyJob, _company: Company): string {
    void _company;
    return job.link;
  }

  protected normalizeJob(job: RadancyJob, company: Company): Job {
    return {
      company: capitalize(company.name),
      role: job.title,
      link: this.getJobLink(job, company),
      location: job.location,
    };
  }

  async fetch(
    company: Company,
    knownKeys: ReadonlySet<string>,
    signal: AbortSignal
  ): Promise<Job[]> {
    const jobs: Job[] = [];
    let listingUrl = company.page;
    let listingCompany = company;

    try {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const response = await postRadancyPage(listingUrl, page, signal);

        if (!response.ok) {
          const location = response.headers.get("location");
          await appendErrorLog(
            `Radancy: ${company.name} - ${response.status} - ${response.statusText}${
              location ? ` - ${location}` : ""
            }`
          );
          break;
        }

        if (response.url) {
          listingUrl = response.url;
          listingCompany = companyForListing(company, response.url);
        }

        const rawJobs = this.getJobsFromResponse(await response.json(), listingCompany);
        if (rawJobs.length === 0) break;

        const opportunities = rawJobs
          .map((job) => this.posting(job, company))
          .filter((posting) => posting.isTarget() && !posting.isKnown(knownKeys))
          .map((posting) => posting.toJob());

        jobs.push(...opportunities);

        if (rawJobs.length < PAGE_SIZE) break;
      }

      return jobs;
    } catch (error) {
      logger.error(
        {
          err: isAbortError(error) ? error.name : error,
          company: company.name,
          url: company.page,
        },
        `${RED_CROSS} Error fetching Radancy jobs`
      );

      return [];
    }
  }

}

export const radancyFetcher = new RadancyFetcher();
