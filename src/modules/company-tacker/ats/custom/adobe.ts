import z from "zod";

import { ABORT_SIGNAL } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { Company } from "../../type";
import type { Job } from "@/types";

import { isTarget, withinDays } from "@/modules/company-tacker/utils";
import { logger } from "@/utils/logger";

const ADOBE_CAREERS_URL = "https://careers.adobe.com/us";

export const AdobeCompany = {
  name: "Adobe",
  ats: "custom",
  identifier: "adobe",
  domain: "https://careers.adobe.com",
  page: ADOBE_CAREERS_URL,
  urls: [],
} as const satisfies Company;

const ADOBE_WIDGETS_URL = "https://careers.adobe.com/widgets";

const PAGE_SIZE = 100;
const MAX_PAGES = 5;

export const AdobeJobSchema = z.object({
  jobId: z.string(),
  title: z.string(),
  postedDate: z.string(),

  city: z.string().optional(),
  cityState: z.string().optional(),
  cityStateCountry: z.string().optional(),
  location: z.string().optional(),
});

type AdobeJob = z.infer<typeof AdobeJobSchema>;

interface AdobeJobsResponse {
  refineSearch?: {
    data?: {
      jobs?: AdobeJob[];
    };
  };
}

interface AdobeSession {
  csrfToken: string;
  cookie: string;
}

function isHtmlResponse(raw: string): boolean {
  const trimmed = raw.trimStart().toLowerCase();

  return (
    trimmed.startsWith("<!doctype") || trimmed.startsWith("<?xml") || trimmed.startsWith("<html")
  );
}

function getSetCookieHeader(res: Response): string {
  const headers = res.headers as Headers & {
    getSetCookie?: () => string[];
  };

  const setCookies = headers.getSetCookie?.();

  if (setCookies?.length) {
    return setCookies
      .map((cookie) => cookie.split(";")[0])
      .filter(Boolean)
      .join("; ");
  }

  const setCookie = res.headers.get("set-cookie");

  if (!setCookie) {
    return "";
  }

  return setCookie
    .split(/,(?=\s*[^;=]+=[^;]+)/)
    .map((cookie) => cookie.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

function extractAdobeCsrfToken(html: string): string | null {
  const patterns = [
    /"csrfToken"\s*:\s*"([^"]+)"/,
    /csrfToken["']?\s*[:=]\s*["']([^"']+)["']/,
    /name=["']csrfToken["']\s+value=["']([^"']+)["']/,
    /name=["']_csrf["']\s+value=["']([^"']+)["']/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

async function getAdobeSession(url: string, signal: AbortSignal): Promise<AdobeSession> {
  const res = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "en-US,en;q=0.9",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
    },
    signal,
  });

  const html = await res.text();

  if (!res.ok || !html) {
    throw new Error(`Failed to fetch Adobe Careers page: ${res.status} ${res.statusText}`);
  }

  const csrfToken = extractAdobeCsrfToken(html);

  if (!csrfToken) {
    throw new Error("Failed to extract Adobe CSRF token");
  }

  return {
    csrfToken,
    cookie: getSetCookieHeader(res),
  };
}

function getAdobeJobLink(job: AdobeJob): string {
  return `${ADOBE_CAREERS_URL}/en/job/${job.jobId}`;
}

function normalizeAdobeJob(job: AdobeJob): Job {
  return {
    company: "Adobe",
    role: job.title,
    link: getAdobeJobLink(job),
    location: job.location ?? job.cityStateCountry ?? job.cityState ?? job.city ?? "",
  };
}

function getAdobeJobsFromResponse(data: AdobeJobsResponse): AdobeJob[] {
  return data.refineSearch?.data?.jobs ?? [];
}

function createAdobeRequestBody(page: number) {
  return {
    lang: "en_us",
    deviceType: "desktop",
    country: "us",
    pageName: "Engineering and Product jobs",
    ddoKey: "refineSearch",
    sortBy: "Most recent",
    subsearch: "",
    from: page * PAGE_SIZE,
    irs: false,
    jobs: true,
    counts: true,
    all_fields: [
      "remote",
      "country",
      "state",
      "city",
      "experienceLevel",
      "category",
      "profession",
      "employmentType",
      "jobLevel",
    ],
    pageType: "category",
    size: PAGE_SIZE,
    rk: "",
    ak: "",
    clearAll: false,
    jdsource: "facets",
    isSliderEnable: false,
    pageId: "page62-ds",
    siteType: "external",
    location: "",
    keywords: "",
    global: true,
    selected_fields: {},
    sort: {
      order: "desc",
      field: "postedDate",
    },
    locationData: {},
  };
}

function createAdobeHeaders(company: Company, session: AdobeSession): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "*/*",
    "accept-language": "en-US,en;q=0.9",
    "content-type": "application/json",
    origin: "https://careers.adobe.com",
    referer: company.page,
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
    "x-csrf-token": session.csrfToken,
  };

  if (session.cookie) {
    headers.cookie = session.cookie;
  }

  return headers;
}

async function fetchAdobePage(
  company: Company,
  page: number,
  session: AdobeSession,
  signal: AbortSignal
): Promise<AdobeJob[]> {
  const res = await fetch(ADOBE_WIDGETS_URL, {
    method: "POST",
    headers: createAdobeHeaders(company, session),
    body: JSON.stringify(createAdobeRequestBody(page)),
    signal,
  });

  const raw = await res.text();

  if (!res.ok || isHtmlResponse(raw)) {
    throw new Error(
      `Adobe widgets failed on page ${page + 1}: ` +
        `${res.status} ${res.statusText} ${raw.slice(0, 300)}`
    );
  }

  let data: AdobeJobsResponse;

  try {
    data = JSON.parse(raw) as AdobeJobsResponse;
  } catch {
    throw new Error(
      `Adobe widgets returned invalid JSON on page ${page + 1}: ${raw.slice(0, 300)}`
    );
  }

  return getAdobeJobsFromResponse(data);
}

export async function fetchAdobe(
  company: Company,
  urls: Set<string>,
  signal: AbortSignal = ABORT_SIGNAL
): Promise<Job[]> {
  try {
    const session = await getAdobeSession(company.page, signal);

    const jobs: Job[] = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      const rawJobs = await fetchAdobePage(company, page, session, signal);

      if (rawJobs.length === 0) {
        break;
      }

      let reachedOldJob = false;

      for (const rawJob of rawJobs) {
        const parsed = AdobeJobSchema.safeParse(rawJob);

        if (!parsed.success) {
          logger.error(
            {
              job: rawJob,
              issues: parsed.error.issues,
            },
            `${RED_CROSS} Invalid Adobe job`
          );

          continue;
        }

        const adobeJob = parsed.data;

        /*
         * Results are sorted by postedDate descending.
         * Once an old job appears, subsequent jobs/pages should be older.
         */
        if (!withinDays(adobeJob.postedDate, 2)) {
          reachedOldJob = true;
          break;
        }

        if (!isTarget(adobeJob.title) || urls.has(getAdobeJobLink(adobeJob))) {
          continue;
        }

        jobs.push(normalizeAdobeJob(adobeJob));
      }

      if (reachedOldJob || rawJobs.length < PAGE_SIZE) {
        break;
      }
    }

    return jobs;
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      logger.error(
        {
          err: error.name,
          company: company.name,
          url: company.page,
        },
        `${RED_CROSS} Error fetching Adobe jobs`
      );

      return [];
    }

    logger.error(
      {
        err: error,
        company: company.name,
        url: company.page,
      },
      `${RED_CROSS} Error fetching Adobe jobs`
    );

    return [];
  }
}
