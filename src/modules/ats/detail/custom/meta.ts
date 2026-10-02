import z from "zod";

import { ABORT_SIGNAL } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import {
  JD_FETCH_ERROR,
  JD_FETCH_OK,
  jdFetchErrorFromResponse,
  type JDFetchResult,
  type JDFetchStatus,
} from "../fetch";

import { MetaCompany } from "@/modules/ats/listing/custom/meta";
import { fetchHtmlResponse, getSetCookieHeader, isHtmlResponse } from "@/utils/http";
import { getLastPathNumber } from "@/utils/job-key/url";
import { logger } from "@/utils/logger";
import { htmlToText, normalizeRawText } from "@/utils/string";

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

async function loadMetaSession(pages: string[], signal: AbortSignal) {
  let lastError: JDFetchStatus = JD_FETCH_ERROR.noData("Failed to extract Meta LSD token");

  for (const page of pages) {
    const { response, html } = await fetchHtmlResponse(page, {
      signal,
      headers: {
        "user-agent": "Mozilla/5.0",
        accept: "text/html",
      },
    });

    if (!response.ok) {
      lastError = jdFetchErrorFromResponse(response);
      continue;
    }

    const lsd = extractLsd(html);
    if (!lsd) {
      continue;
    }

    return {
      lsd,
      cookie: getSetCookieHeader(response),
      referer: page,
    };
  }

  return { error: lastError };
}

export async function fetchMetaJD(
  url: string,
  signal: AbortSignal = ABORT_SIGNAL
): Promise<JDFetchResult> {
  const jobId = getLastPathNumber(new URL(url).pathname);

  if (!jobId) {
    return {
      jd: null,
      error: JD_FETCH_ERROR.invalidUrl("Job ID not found"),
    };
  }

  const session = await loadMetaSession([url, MetaCompany.page], signal);

  if ("error" in session) {
    return { jd: null, error: session.error ?? JD_FETCH_ERROR.noData() };
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
      error: res.ok ? JD_FETCH_ERROR.noData() : jdFetchErrorFromResponse(res),
    };
  }

  const parsed = MetaJobDetailsResponseSchema.safeParse(JSON.parse(cleanMetaJson(raw)));
  const job = parsed.success ? parsed.data.data?.xcp_requisition_job_description : null;
  const jd = job ? formatMetaJobDescription(job) : null;

  if (!jd) {
    return { jd: null, error: JD_FETCH_ERROR.noData() };
  }

  return { jd, error: JD_FETCH_OK };
}
