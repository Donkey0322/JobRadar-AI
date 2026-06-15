import { RED_CROSS } from "@/constants/log";

import type { Company } from "../../type";
import type { Job } from "@/types";

import { isTarget } from "@/modules/company-tacker/utils";
import { logger } from "@/utils/logger";
import { capitalize } from "@/utils/string";

const META_GRAPHQL_URL = "https://www.metacareers.com/api/graphql/";

const META_DOC_ID = "27506805582236862";
const META_FRIENDLY_NAME = "CareersJobSearchResultsDataQuery";

interface MetaJob {
  id?: string;
  title?: string;
  locations?: string[];
}

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

function getMetaJobId(job: MetaJob): string {
  return job.id ?? "";
}

function getMetaJobLink(job: MetaJob): string {
  const id = getMetaJobId(job);

  return id ? `https://www.metacareers.com/profile/job_details/${id}` : "";
}

function getMetaJobLocation(job: MetaJob): string {
  if (!job.locations?.length) {
    return "";
  }

  return job.locations
    .map((location) => {
      if (typeof location === "string") {
        return location;
      }

      return location ?? "";
    })
    .filter(Boolean)
    .join(", ");
}

function getMetaJobsFromResponse(data: MetaJobsResponse): MetaJob[] {
  return data.data?.job_search_with_featured_jobs?.all_jobs ?? [];
}

export async function fetchMeta(
  company: Company,
  urls: Set<string>,
  signal: AbortSignal
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

    const jobs = getMetaJobsFromResponse(data).filter((job) => {
      const title = job.title ?? "";
      const link = getMetaJobLink(job);

      return isTarget(title) && !!link && !urls.has(link);
    });

    return jobs.map((job) => ({
      company: capitalize(company.name),
      role: job.title ?? "",
      link: getMetaJobLink(job),
      location: getMetaJobLocation(job),
    }));
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
