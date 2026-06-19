import * as cheerio from "cheerio";

import { ABORT_SIGNAL } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { JDFetchResult } from "../index";

import { JD_FETCH_ERROR, JD_FETCH_OK } from "../index";

import { extractAppleJD } from "./apple";

import { logger } from "@/utils/logger";

const FALLBACK_JD_MAX_CHARS = 12_000;

const JD_KEYWORDS = [
  "minimum qualifications",
  "preferred qualifications",
  "basic qualifications",
  "responsibilities",
  "requirements",
  "qualifications",
  "about the job",
  "about this role",
  "job description",
  "what you'll do",
  "what you will do",
  "who you are",
];

function normalizeRawText(text: string): string | null {
  const lines = text
    .split("\n")
    .map((ln) => ln.replace(/\s+/g, " ").trim())
    .filter((ln) => ln.length > 0);

  return lines.length ? lines.join("\n") : null;
}

function limitRawText(text: string, maxChars = FALLBACK_JD_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[TRUNCATED]`;
}

function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  return $.root().text();
}

function getString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string").join(", ");
  return "";
}

function extractLocation(value: unknown): string {
  if (!value) return "";

  const locations = Array.isArray(value) ? value : [value];

  return locations
    .map((location) => {
      if (!location || typeof location !== "object") return "";

      const address = (location as Record<string, unknown>).address;
      if (!address || typeof address !== "object") return "";

      const obj = address as Record<string, unknown>;

      return [
        getString(obj.addressLocality),
        getString(obj.addressRegion),
        getString(obj.addressCountry),
      ]
        .filter(Boolean)
        .join(", ");
    })
    .filter(Boolean)
    .join(" | ");
}

function extractJobPostingFromLdJson(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw);
    const nodes = Array.isArray(parsed) ? parsed : [parsed];

    const jobPosting = nodes.find((node) => {
      if (!node || typeof node !== "object") return false;

      const type = (node as Record<string, unknown>)["@type"];
      return type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
    });

    if (!jobPosting || typeof jobPosting !== "object") {
      return null;
    }

    const obj = jobPosting as Record<string, unknown>;

    const title = getString(obj.title);
    const description = htmlToText(getString(obj.description));
    const location = extractLocation(obj.jobLocation);
    const employmentType = getString(obj.employmentType);
    const datePosted = getString(obj.datePosted);
    const qualifications = getString(obj.qualifications);

    return `
Title:
${title}

Location:
${location}

Employment Type:
${employmentType}

Date Posted:
${datePosted}

Description:
${description}

Qualifications:
${qualifications}
`;
  } catch {
    return null;
  }
}

function isLikelyJDText(text: string): boolean {
  if (text.length < 300) return false;

  const lower = text.toLowerCase();
  return JD_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function extractRelevantWindow(text: string, maxChars = FALLBACK_JD_MAX_CHARS): string {
  const lower = text.toLowerCase();

  const indexes = JD_KEYWORDS.map((keyword) => lower.indexOf(keyword))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b);

  if (!indexes.length) {
    return text.slice(0, maxChars);
  }

  const start = Math.max(0, indexes[0] - 1_000);
  return text.slice(start, start + maxChars);
}

function extractFallbackJD(html: string): string | null {
  const appleJD = extractAppleJD(html);

  if (appleJD) {
    return normalizeRawText(limitRawText(appleJD));
  }

  const $ = cheerio.load(html);

  const ldJsonTexts = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).text())
    .get()
    .filter(Boolean);
  const structuredText = ldJsonTexts.map(extractJobPostingFromLdJson).find(Boolean);

  if (structuredText) {
    return normalizeRawText(limitRawText(structuredText));
  }

  $("script, style, noscript, svg, img, iframe, link, meta, nav, header, footer, aside").remove();

  const selectors = [
    "[data-automation-id='jobPostingDescription']",
    "[data-testid='job-description']",
    "[class*='job-description']",
    "[class*='jobDescription']",
    "[id*='job-description']",
    "[id*='jobDescription']",
    "main",
    "article",
  ];

  for (const selector of selectors) {
    const text = normalizeRawText($(selector).first().text());

    if (text && isLikelyJDText(text)) {
      return limitRawText(text);
    }
  }

  const bodyText = normalizeRawText($("body").text());

  if (!bodyText) {
    return null;
  }

  return normalizeRawText(limitRawText(extractRelevantWindow(bodyText)));
}

export async function fetchCustomJD(
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
    logger.error({ url, status: res.status }, `${RED_CROSS} Failed to fetch text`);
    return {
      jd: null,
      error: JD_FETCH_ERROR.http(res.status, res.statusText),
    };
  }

  const html = await res.text();
  const jd = extractFallbackJD(html);

  if (!jd) {
    return { jd: null, error: JD_FETCH_ERROR.noData() };
  }

  return { jd, error: JD_FETCH_OK };
}
