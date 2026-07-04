import z from "zod";

import { ABORT_SIGNAL } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { Company } from "../../type";
import type { Job } from "@/types";

import { isTarget } from "@/modules/company-tacker/utils";
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

interface MetaJobsResponse {
  data?: {
    job_search_with_featured_jobs?: {
      all_jobs?: MetaJob[];
    };
  };
}

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

function isHtmlResponse(raw: string): boolean {
  const trimmed = raw.trimStart();

  return (
    trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<?xml") || trimmed.startsWith("<html")
  );
}

function cleanMetaJson(raw: string): string {
  return raw.replace(/^for\s*\(;;\);/, "");
}

function getSetCookieHeader(res: Response): string {
  const headers = res.headers as Headers & {
    getSetCookie?: () => string[];
  };

  const setCookies = headers.getSetCookie?.();

  if (setCookies?.length) {
    return setCookies.map((cookie) => cookie.split(";")[0]).join("; ");
  }

  const setCookie = res.headers.get("set-cookie");

  if (!setCookie) {
    return "";
  }

  return setCookie
    .split(/,(?=\s*[^;=]+=[^;]+)/)
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

async function getMetaSession(url: string, signal: AbortSignal) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      accept: "text/html",
    },
    signal,
  });

  const html = await res.text();

  if (!res.ok || !html) {
    throw new Error(`Failed to fetch Meta Careers page: ${res.status}`);
  }

  if (isHtmlResponse(html) && html.includes("<title>Error</title>")) {
    throw new Error(`Meta Careers returned error page: ${res.status}`);
  }

  const lsd = extractLsd(html);

  if (!lsd) {
    throw new Error("Failed to extract Meta LSD token");
  }

  return {
    lsd,
    jazoest: buildJazoest(lsd),
    cookie: getSetCookieHeader(res),
  };
}

function getMetaJobsFromResponse(data: MetaJobsResponse): MetaJob[] {
  return data.data?.job_search_with_featured_jobs?.all_jobs ?? [];
}

function normalizeMetaJob(job: MetaJob): Job | null {
  const link = job.id ? `${META_DETAILS_URL}/${job.id}` : "";

  if (!link) {
    return null;
  }

  const location = !job.locations?.length
    ? ""
    : job.locations
        .map((l) => (typeof l === "string" ? l : ""))
        .filter(Boolean)
        .join(", ");

  return {
    company: "Meta",
    role: job.title ?? "",
    link,
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

    const data = JSON.parse(cleanMetaJson(raw)) as MetaJobsResponse;
    const rawJobs = getMetaJobsFromResponse(data);
    const jobs: Job[] = [];

    for (const rawJob of rawJobs) {
      const parsed = MetaJobSchema.safeParse(rawJob);

      if (!parsed.success) {
        logger.error({ job: rawJob, issues: parsed.error.issues }, `${RED_CROSS} Invalid Meta job`);

        continue;
      }

      const metaJob = parsed.data;
      const title = metaJob.title ?? "";
      const link = metaJob.id ? `${META_DETAILS_URL}/${metaJob.id}` : "";

      if (!isTarget(title) || !link || urls.has(link)) {
        continue;
      }

      const job = normalizeMetaJob(metaJob);

      if (!job) {
        continue;
      }

      jobs.push(job);
    }

    return jobs;
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
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
