import * as cheerio from "cheerio";

import { ABORT_SIGNAL } from "@/constants";

import { JD_FETCH_ERROR, JD_FETCH_OK, type JDFetchResult } from "../fetch";

const APPLE_HYDRATION_PATTERN =
  /window\.__staticRouterHydrationData\s*=\s*JSON\.parse\(\s*(["'])((?:\\.|(?!\1)[\s\S])*)\1\s*\)/;

function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  return $.root().text();
}

function getString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string").join("\n");
  return "";
}

function getFirstObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function decodeJsStringLiteral(raw: string, quote: string): string {
  // Apple 是 JSON.parse('...')，這裡只把 JS string literal decode 成真正 JSON 字串
  // 不執行頁面 script，只 decode 這個 string argument
  return Function(`"use strict"; return ${quote}${raw}${quote};`)();
}

function parseAppleHydrationData(html: string): unknown | null {
  const match = html.match(APPLE_HYDRATION_PATTERN);

  if (!match?.[2]) {
    return null;
  }

  try {
    const quote = match[1];
    const raw = match[2];

    // 有些情況 raw 本身就是 JSON，有些是 JS string literal escape 過
    try {
      return JSON.parse(raw);
    } catch {
      const decoded = decodeJsStringLiteral(raw, quote);
      return JSON.parse(decoded);
    }
  } catch {
    return null;
  }
}

function findAppleJobsData(
  value: unknown,
  seen = new Set<object>()
): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (seen.has(value)) {
    return null;
  }

  seen.add(value);

  const obj = value as Record<string, unknown>;

  const jobsData = getFirstObject(obj.jobsData);
  if (
    jobsData &&
    (jobsData.postingTitle || jobsData.jobSummary || jobsData.description || jobsData.localizations)
  ) {
    return jobsData;
  }

  for (const child of Object.values(obj)) {
    const found = findAppleJobsData(child, seen);
    if (found) return found;
  }

  return null;
}

function getApplePosting(jobsData: Record<string, unknown>): Record<string, unknown> {
  const localizations = getFirstObject(jobsData.localizations);

  if (!localizations) {
    return jobsData;
  }

  const enUS = getFirstObject(localizations.en_US);
  const enUSPosting = getFirstObject(enUS?.posting);

  if (enUSPosting) {
    return enUSPosting;
  }

  for (const localization of Object.values(localizations)) {
    const localizationObj = getFirstObject(localization);
    const posting = getFirstObject(localizationObj?.posting);

    if (posting) {
      return posting;
    }
  }

  return jobsData;
}

function extractAppleLocations(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((location) => {
      if (!location || typeof location !== "object") return "";

      const obj = location as Record<string, unknown>;

      return [
        getString(obj.name),
        getString(obj.city),
        getString(obj.stateProvince),
        getString(obj.countryName),
      ]
        .filter(Boolean)
        .join(", ");
    })
    .filter(Boolean)
    .join(" | ");
}

function cleanMaybeHtml(value: unknown): string {
  return htmlToText(getString(value));
}

export function extractAppleJD(html: string): string | null {
  const data = parseAppleHydrationData(html);

  if (!data) {
    return null;
  }

  const jobsData = findAppleJobsData(data);

  if (!jobsData) {
    return null;
  }

  const posting = getApplePosting(jobsData);

  const title = getString(posting.postingTitle) || getString(jobsData.postingTitle);
  const summary = cleanMaybeHtml(posting.jobSummary) || cleanMaybeHtml(jobsData.jobSummary);
  const description = cleanMaybeHtml(posting.description) || cleanMaybeHtml(jobsData.description);

  const minimumQualifications =
    cleanMaybeHtml(posting.minimumQualifications) || cleanMaybeHtml(jobsData.minimumQualifications);

  const preferredQualifications =
    cleanMaybeHtml(posting.preferredQualifications) ||
    cleanMaybeHtml(jobsData.preferredQualifications);

  const educationAndExperience =
    cleanMaybeHtml(posting.educationAndExperience) ||
    cleanMaybeHtml(jobsData.educationAndExperience);

  const additionalRequirements =
    cleanMaybeHtml(posting.additionalRequirements) ||
    cleanMaybeHtml(jobsData.additionalRequirements);

  const locations = extractAppleLocations(jobsData.locations);

  const teamNames = Array.isArray(jobsData.teamNames)
    ? jobsData.teamNames.filter((team) => typeof team === "string").join(", ")
    : "";

  const result = `
Title:
${title}

Location:
${locations}

Team:
${teamNames}

Posted:
${getString(jobsData.postingDateMeta) || getString(jobsData.postDateInGMT)}

Summary:
${summary}

Description:
${description}

Minimum Qualifications:
${minimumQualifications}

Preferred Qualifications:
${preferredQualifications}

Education & Experience:
${educationAndExperience}

Additional Requirements:
${additionalRequirements}
`.trim();

  return result.length ? result : null;
}

export async function fetchAppleJD(
  url: string,
  signal: AbortSignal = ABORT_SIGNAL
): Promise<JDFetchResult> {
  const res = await fetch(url, {
    signal,
    headers: {
      "User-Agent": "Mozilla/5.0 (JD-Analyzer)",
    },
  });

  if (!res.ok) {
    return {
      jd: null,
      error: JD_FETCH_ERROR.http(res.status, res.statusText),
    };
  }

  const html = await res.text();
  const jd = extractAppleJD(html);

  if (!jd) {
    return {
      jd: null,
      error: JD_FETCH_ERROR.noData(),
    };
  }

  return {
    jd: jd ?? null,
    error: JD_FETCH_OK,
  };
}
