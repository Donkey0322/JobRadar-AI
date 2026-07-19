import z from "zod";

import { ABORT_SIGNAL } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { Company } from "../../type";
import type { Job } from "@/types";

import { isTarget } from "@/modules/company-tacker/utils";
import { fetchHtmlResponse, getSetCookieHeader, isAbortError, isHtmlResponse } from "@/utils/http";
import { logger } from "@/utils/logger";

const META_CAREERS_URL = "https://www.metacareers.com/jobsearch";
const META_GRAPHQL_URL = "https://www.metacareers.com/api/graphql/";
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

function extractLsd(html: string): string | null {
  const patterns = [
    /\["LSD",\[\],\{"token":"([^"]+)"\}/,
    /"LSD",\[\],\{"token":"([^"]+)"\}/,
    /name="lsd"\s+value="([^"]+)"/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function buildJazoest(lsd: string): string {
  return `2${Array.from(lsd)
    .map((char) => char.charCodeAt(0))
    .join("")}`;
}

function cleanMetaJson(raw: string): string {
  return raw.replace(/^for\s*\(;;\);/, "");
}

async function getMetaSession(url: string, signal: AbortSignal) {
  const { response, html } = await fetchHtmlResponse(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      accept: "text/html",
    },
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
    jazoest: buildJazoest(lsd),
    cookie: getSetCookieHeader(response),
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
  urls: Set<string>,
  signal: AbortSignal = ABORT_SIGNAL
): Promise<Job[]> {
  try {
    const { lsd, jazoest, cookie } = await getMetaSession(company.page, signal);

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

    const body = new URLSearchParams({
      av: "0",
      __user: "0",
      __a: "1",
      __req: "3",
      __comet_req: "31",

      lsd,
      jazoest,

      fb_api_caller_class: "RelayModern",
      fb_api_req_friendly_name: META_FRIENDLY_NAME,
      server_timestamps: "true",
      variables: JSON.stringify(variables),
      doc_id: META_DOC_ID,
    });

    const headers: Record<string, string> = {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "Mozilla/5.0",
      "x-fb-lsd": lsd,
      "x-asbd-id": "359341",
      origin: "https://www.metacareers.com",
      referer: company.page,
    };

    if (cookie) {
      headers.cookie = cookie;
    }

    const res = await fetch(META_GRAPHQL_URL, {
      method: "POST",
      headers,
      body,
      signal,
    });

    const raw = await res.text();

    if (!res.ok || isHtmlResponse(raw)) {
      throw new Error(`Meta GraphQL failed: ${res.status} ${raw.slice(0, 300)}`);
    }

    const rawJobs = getMetaJobsFromResponse(JSON.parse(cleanMetaJson(raw)));

    const opportunities = rawJobs
      .filter((job) => {
        const title = job.title ?? "";
        const link = job.id ? `${META_DETAILS_URL}/${job.id}` : null;

        return !!(link && isTarget(title) && !urls.has(link));
      })
      .map(normalizeMetaJob);

    return opportunities;
  } catch (error) {
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
