import z from "zod";

import { createJDFetchSignal } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import {
  JD_FETCH_ERROR,
  JD_FETCH_OK,
  jdFetchErrorFromResponse,
  type JDFetchResult,
  type JDFetchStatus,
} from "../fetch";

import {
  fetchHtmlResponse,
  getSetCookieHeader,
  isHtmlResponse,
  type HtmlResponse,
} from "@/utils/http";
import { getLastPathNumber } from "@/utils/job-key/url";
import { logger } from "@/utils/logger";
import { htmlToText, normalizeRawText } from "@/utils/string";

const META_CAREERS_PAGE = "https://www.metacareers.com/jobsearch";
const META_GRAPHQL_URL = "https://www.metacareers.com/api/graphql/";
const META_JOB_DETAILS_DOC_ID = "27371134039243725";
const META_JOB_DETAILS_QUERY = "CandidatePortalJobDetailsViewQuery";

const HtmlFieldSchema = z.string().nullable().optional();
const QualificationSchema = z.object({ item: z.string() });
const CompensationSchema = z.object({
  country_code: z.string().optional(),
  compensation_amount_minimum: z.string().optional(),
  compensation_amount_maximum: z.string().optional(),
});

const MetaJobDescriptionSchema = z.object({
  title: z.string().optional(),
  locations: z.array(z.unknown()).optional(),
  departments: z.array(z.string()).optional(),
  description: HtmlFieldSchema,
  responsibilities: z.array(QualificationSchema).optional(),
  minimum_qualifications: z.array(QualificationSchema).optional(),
  preferred_qualifications: z.array(QualificationSchema).optional(),
  public_compensation: z.array(CompensationSchema).optional(),
});

const MetaJobDetailsResponseSchema = z.object({
  data: z
    .object({
      xcp_requisition_job_description: MetaJobDescriptionSchema.nullable().optional(),
    })
    .nullable()
    .optional(),
});

type MetaJobDescription = z.infer<typeof MetaJobDescriptionSchema>;

const META_JSON_SCRIPT = /<script\s+type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi;

function findMetaJobDescription(node: unknown): MetaJobDescription | null {
  if (!node || typeof node !== "object") {
    return null;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findMetaJobDescription(item);
      if (found) return found;
    }

    return null;
  }

  const record = node as Record<string, unknown>;

  if ("xcp_requisition_job_description" in record) {
    const parsed = MetaJobDescriptionSchema.safeParse(record.xcp_requisition_job_description);

    if (parsed.success && formatMetaJobDescription(parsed.data)) {
      return parsed.data;
    }
  }

  for (const value of Object.values(record)) {
    const found = findMetaJobDescription(value);
    if (found) return found;
  }

  return null;
}

/** Job pages preload the description. GraphQL is only the fallback. */
export function extractMetaJobFromHtml(html: string): MetaJobDescription | null {
  for (const match of html.matchAll(META_JSON_SCRIPT)) {
    const raw = match[1];

    if (!raw?.includes("xcp_requisition_job_description")) {
      continue;
    }

    try {
      const job = findMetaJobDescription(JSON.parse(raw) as unknown);
      if (job) return job;
    } catch {
      continue;
    }
  }

  return null;
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

function cleanMetaJson(raw: string): string {
  return raw.replace(/^for\s*\(;;\);/, "");
}

function textFromMetaHtml(value: string | null | undefined): string {
  if (!value) return "";

  let html = value;

  if (value.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(value) as { __html?: unknown };
      if (typeof parsed.__html === "string") {
        html = parsed.__html;
      }
    } catch {
      html = value;
    }
  }

  return htmlToText(html);
}

function locationName(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  if (typeof record.name === "string") return record.name;
  if (typeof record.label === "string") return record.label;

  return "";
}

function bulletSection(title: string, items: { item: string }[] | undefined): string {
  const lines = (items ?? []).map((item) => item.item.trim()).filter(Boolean);
  if (lines.length === 0) return "";

  return `${title}:\n${lines.map((line) => `- ${line}`).join("\n")}`;
}

function compensationSection(items: z.infer<typeof CompensationSchema>[] | undefined): string {
  const lines = (items ?? [])
    .map((item) => {
      const range = [item.compensation_amount_minimum, item.compensation_amount_maximum]
        .filter(Boolean)
        .join(" - ");

      return [item.country_code, range].filter(Boolean).join(": ");
    })
    .filter(Boolean);

  if (lines.length === 0) return "";

  return `Compensation:\n${lines.join("\n")}`;
}

export function formatMetaJobDescription(job: MetaJobDescription): string | null {
  const locations = (job.locations ?? []).map(locationName).filter(Boolean);

  return normalizeRawText(
    [
      job.title ?? "",
      (job.departments ?? []).join(", "),
      locations.join(", "),
      textFromMetaHtml(job.description),
      bulletSection("Responsibilities", job.responsibilities),
      bulletSection("Minimum Qualifications", job.minimum_qualifications),
      bulletSection("Preferred Qualifications", job.preferred_qualifications),
      compensationSection(job.public_compensation),
    ].join("\n\n")
  );
}

const META_PAGE_HEADERS = {
  "user-agent": "Mozilla/5.0",
  accept: "text/html",
};

type MetaPage = {
  url: string;
  document?: HtmlResponse;
};

async function loadMetaSession(pages: MetaPage[], signal: AbortSignal) {
  let lastError: JDFetchStatus = JD_FETCH_ERROR.fetch("Failed to extract Meta LSD token");

  for (const page of pages) {
    const document =
      page.document ??
      (await fetchHtmlResponse(page.url, {
        signal,
        headers: META_PAGE_HEADERS,
      }));

    if (!document.response.ok) {
      lastError = jdFetchErrorFromResponse(document.response);
      continue;
    }

    const lsd = extractLsd(document.html);
    if (!lsd) {
      continue;
    }

    return {
      lsd,
      cookie: getSetCookieHeader(document.response),
      referer: page.url,
    };
  }

  return { error: lastError };
}

export async function fetchMetaJD(
  url: string,
  signal: AbortSignal = createJDFetchSignal()
): Promise<JDFetchResult> {
  const jobId = getLastPathNumber(new URL(url).pathname);

  if (!jobId) {
    return {
      jd: null,
      error: JD_FETCH_ERROR.invalidUrl("Job ID not found"),
    };
  }

  const page = await fetchHtmlResponse(url, {
    signal,
    headers: META_PAGE_HEADERS,
  });

  if (page.response.ok) {
    const embedded = extractMetaJobFromHtml(page.html);
    const preloaded = embedded ? formatMetaJobDescription(embedded) : null;

    if (preloaded) {
      return { jd: preloaded, error: JD_FETCH_OK };
    }
  }

  const session = await loadMetaSession(
    [{ url, document: page }, { url: META_CAREERS_PAGE }],
    signal
  );

  if ("error" in session) {
    return {
      jd: null,
      error: session.error ?? JD_FETCH_ERROR.fetch("Failed to load Meta session"),
    };
  }

  const body = new URLSearchParams({
    av: "0",
    __user: "0",
    __a: "1",
    __req: "3",
    __comet_req: "31",
    lsd: session.lsd,
    jazoest: buildJazoest(session.lsd),
    fb_api_caller_class: "RelayModern",
    fb_api_req_friendly_name: META_JOB_DETAILS_QUERY,
    server_timestamps: "true",
    variables: JSON.stringify({
      renderLoggedInView: false,
      requisitionID: jobId,
      viewasUserID: null,
    }),
    doc_id: META_JOB_DETAILS_DOC_ID,
  });

  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    "user-agent": "Mozilla/5.0",
    "x-fb-lsd": session.lsd,
    "x-asbd-id": "359341",
    origin: "https://www.metacareers.com",
    referer: session.referer,
  };

  if (session.cookie) {
    headers.cookie = session.cookie;
  }

  const res = await fetch(META_GRAPHQL_URL, {
    method: "POST",
    headers,
    body,
    signal,
  });

  const raw = await res.text();

  if (!res.ok || isHtmlResponse(raw)) {
    logger.error({ url, status: res.status }, `${RED_CROSS} Failed to fetch Meta job description`);

    return {
      jd: null,
      error: res.ok
        ? JD_FETCH_ERROR.fetch("Meta returned an HTML page instead of job JSON")
        : jdFetchErrorFromResponse(res),
    };
  }

  let payload: unknown;

  try {
    payload = JSON.parse(cleanMetaJson(raw)) as unknown;
  } catch {
    return {
      jd: null,
      error: JD_FETCH_ERROR.fetch("Meta job JSON was unreadable"),
    };
  }

  const parsed = MetaJobDetailsResponseSchema.safeParse(payload);
  const job = parsed.success ? parsed.data.data?.xcp_requisition_job_description : null;
  const jd = job ? formatMetaJobDescription(job) : null;

  if (!jd) {
    return { jd: null, error: JD_FETCH_ERROR.noData() };
  }

  return { jd, error: JD_FETCH_OK };
}
