import z from "zod";

import { RED_CROSS } from "@/constants/log";

import type { Company, Job } from "@/types";

import {
  cleanMetaJson,
  extractLsd,
  META_CAREERS_URL,
  META_PAGE_HEADERS,
  postMetaGraphql,
} from "@/modules/ats/custom/meta";
import { ListingHttpError, logListingFailure } from "@/modules/employer/failure";
import { createJDFetchSignal } from "@/modules/posting/jd/signal";
import { Posting } from "@/modules/posting/posting";
import { fetchHtmlResponse, getSetCookieHeader, isAbortError, isHtmlResponse } from "@/utils/http";
import { logger } from "@/utils/logger";

const META_DETAILS_URL = "https://www.metacareers.com/profile/job_details";
const META_DOC_ID = "27506805582236862";
const META_FRIENDLY_NAME = "CareersJobSearchResultsDataQuery";

export const MetaCompany = {
  name: "Meta",
  ats: "custom",
  identifier: "meta",
  domain: "https://www.metacareers.com",
  page: META_CAREERS_URL,
  urls: [],
} as const satisfies Company;

export const MetaJobSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  locations: z.array(z.string()).optional(),
});

type MetaJob = z.infer<typeof MetaJobSchema>;

export const MetaResponseSchema = z.object({
  data: z
    .object({
      job_search_with_featured_jobs: z
        .object({
          all_jobs: z.array(MetaJobSchema),
        })
        .optional(),
    })
    .optional(),
});

async function getMetaSession(url: string, signal: AbortSignal) {
  const { response, html } = await fetchHtmlResponse(url, {
    headers: META_PAGE_HEADERS,
    signal,
  });

  if (!response.ok || !html) {
    throw new Error(`Failed to fetch Meta Careers page: ${response.status}`);
  }

  if (isHtmlResponse(html) && html.includes("<title>Error</title>")) {
    throw new Error(`Meta Careers returned error page: ${response.status}`);
  }

  const lsd = extractLsd(html);

  if (!lsd) {
    throw new Error("Failed to extract Meta LSD token");
  }

  return {
    lsd,
    cookie: getSetCookieHeader(response),
    referer: url,
  };
}

function getMetaJobsFromResponse(data: unknown): MetaJob[] {
  const parsed = MetaResponseSchema.safeParse(data);

  if (!parsed.success) {
    logger.error({ data, issues: parsed.error.issues }, `${RED_CROSS} Invalid Meta response`);

    return [];
  }

  return parsed.data.data?.job_search_with_featured_jobs?.all_jobs ?? [];
}

function normalizeMetaJob(job: MetaJob): Job {
  const location = !job.locations?.length
    ? ""
    : job.locations
        .map((l) => (typeof l === "string" ? l : ""))
        .filter(Boolean)
        .join(", ");

  return {
    company: "Meta",
    role: job.title ?? "",
    // id is guaranteed by the filter step
    link: `${META_DETAILS_URL}/${job.id}`,
    location,
  };
}

export async function fetchMeta(
  company: Company,
  knownKeys: ReadonlySet<string>,
  signal: AbortSignal = createJDFetchSignal()
): Promise<Job[]> {
  try {
    const session = await getMetaSession(company.page, signal);

    const variables = {
      search_input: {
        q: null,
        divisions: [],
        offices: [],
        roles: [],
        leadership_levels: [],
        saved_jobs: [],
        saved_searches: [],
        sub_teams: [],
        teams: [],
        is_leadership: false,
        is_remote_only: false,
        sort_by_new: true,
        results_per_page: null,
      },
      viewasUserID: null,
      isLoggedIn: false,
    };

    const res = await postMetaGraphql(
      session,
      { friendlyName: META_FRIENDLY_NAME, docId: META_DOC_ID, variables },
      signal
    );

    const raw = await res.text();

    if (!res.ok) {
      throw ListingHttpError.from(res, "GraphQL");
    }

    if (isHtmlResponse(raw)) {
      throw new ListingHttpError("GraphQL returned HTML instead of JSON");
    }

    const rawJobs = getMetaJobsFromResponse(JSON.parse(cleanMetaJson(raw)));

    const opportunities = rawJobs
      .filter((job) => Boolean(job.id))
      .map((job) => Posting.from(normalizeMetaJob(job)))
      .filter((posting) => posting.isTarget() && !posting.isKnown(knownKeys))
      .map((posting) => posting.toJob());

    return opportunities;
  } catch (error) {
    if (await logListingFailure("Meta", company, error)) return [];

    if (isAbortError(error)) {
      logger.error(
        { err: error.name, company: company.name, url: company.page },
        `${RED_CROSS} Error fetching meta jobs`
      );

      return [];
    }

    logger.error({ err: error, company: company.name }, `${RED_CROSS} Error fetching meta jobs`);

    return [];
  }
}
