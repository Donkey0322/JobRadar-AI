import z from "zod";

import { RED_CROSS } from "@/constants/log";

import type { Company, Job } from "@/types";

import { ATSFetcher } from "../core/fetcher";
import { isTarget } from "../core/filter";

import {
  getRadancyCompanyName,
  getRadancyResultsPostUrl,
  parseRadancyJobs,
} from "@/modules/ats/shared/radancy";
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

export class RadancyFetcher extends ATSFetcher<RadancyJob> {
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

    try {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const response = await fetch(company.page, {
          method: "POST",
          signal,
          headers: {
            accept: "application/json, text/javascript, */*; q=0.01",
            "content-type": "application/json; charset=utf-8",
            referer: company.page.replace(/\/resultspost\/?$/, ""),
            "x-requested-with": "XMLHttpRequest",
            "user-agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
          },
          body: JSON.stringify(createRadancyRequestBody(page)),
        });

        if (!response.ok) {
          await appendErrorLog(
            `Radancy: ${company.name} - ${response.status} - ${response.statusText}`
          );
          break;
        }

        const rawJobs = this.getJobsFromResponse(await response.json(), company);
        if (rawJobs.length === 0) break;

        const opportunities = rawJobs
          .filter((job) => isTarget(job.title) && !this.isKnownJob(job.link, knownKeys))
          .map((job) => this.normalizeJob(job, company));

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
