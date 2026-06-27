import * as cheerio from "cheerio";

import { ABORT_SIGNAL } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { JDFetchResult } from "./fetch";

import { JD_FETCH_ERROR, JD_FETCH_OK } from "./fetch";

import { logger } from "@/utils/logger";
import { cleanText, htmlToText, normalizeRawText } from "@/utils/string";

const FALLBACK_JD_MAX_CHARS = 12_000;
const MIN_JD_LENGTH = 300;

const ICIMS_JD_KEYWORDS = [
  "overview",
  "responsibilities",
  "qualifications",
  "requirements",
  "what we are looking for",
  "what you'll do",
  "what you will do",
  "about the role",
  "about this role",
  "job description",
];

function limitRawText(text: string, maxChars = FALLBACK_JD_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[TRUNCATED]`;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function getString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string").join(", ");
  return "";
}

function extractLocationFromLdJsonValue(value: unknown): string {
  if (!value) return "";

  const locations = Array.isArray(value) ? value : [value];

  return locations
    .map((location) => {
      if (!location || typeof location !== "object") return "";

      const obj = location as Record<string, unknown>;

      const address = obj.address;

      // Some JSON-LD uses plain string
      if (typeof address === "string") return address;

      if (!address || typeof address !== "object") return "";

      const addressObj = address as Record<string, unknown>;

      return [
        getString(addressObj.addressLocality),
        getString(addressObj.addressRegion),
        getString(addressObj.addressCountry),
      ]
        .filter(Boolean)
        .join(", ");
    })
    .filter(Boolean)
    .join(" | ");
}

function isIcimsJobUrl(url: URL): boolean {
  return url.hostname.endsWith(".icims.com") && /\/jobs\/\d+\/[^/]+\/job\/?$/.test(url.pathname);
}

function normalizeIcimsJobUrl(url: string): string {
  const normalized = new URL(url);

  normalized.search = "";
  normalized.searchParams.set("in_iframe", "1");

  return normalized.toString();
}

function findIcimsJobIframeSrc(html: string, baseUrl: string): string | null {
  const $ = cheerio.load(html);

  const normalSrc =
    $("iframe[src*='icims.com/jobs/'][src*='/job']").attr("src") ??
    $("iframe[src*='/jobs/'][src*='/job']").attr("src");

  if (normalSrc) {
    return new URL(decodeHtmlEntities(normalSrc), baseUrl).toString();
  }

  for (const el of $("noscript").toArray()) {
    const noscriptHtml = $(el).html() ?? $(el).text();
    if (!noscriptHtml) continue;

    const $$ = cheerio.load(noscriptHtml);

    const src =
      $$("iframe[src*='icims.com/jobs/'][src*='/job']").attr("src") ??
      $$("iframe[src*='/jobs/'][src*='/job']").attr("src");

    if (src) {
      return new URL(decodeHtmlEntities(src), baseUrl).toString();
    }
  }

  const iframeMatch = html.match(
    /<iframe[^>]+src=["']([^"']*(?:icims\.com\/jobs\/\d+\/[^"']*\/job|\/jobs\/\d+\/[^"']*\/job)[^"']*)["']/i
  );

  if (iframeMatch?.[1]) {
    return new URL(decodeHtmlEntities(iframeMatch[1]), baseUrl).toString();
  }

  const rawUrlMatch = html.match(
    /https?:\/\/[^"'<>\s]+\.icims\.com\/jobs\/\d+\/[^"'<>\s]+\/job[^"'<>\s]*/i
  );

  if (rawUrlMatch?.[0]) {
    return decodeHtmlEntities(rawUrlMatch[0]);
  }

  return null;
}

async function fetchHtml(
  url: string,
  signal: AbortSignal
): Promise<{
  html: string | null;
  error: JDFetchResult["error"];
}> {
  const res = await fetch(url, {
    signal,
    headers: {
      "User-Agent": "Mozilla/5.0 (JD-Analyzer)",
      Accept: "text/html",
    },
  });

  if (!res.ok) {
    logger.error({ url, status: res.status }, `${RED_CROSS} Failed to fetch iCIMS JD`);

    return {
      html: null,
      error: JD_FETCH_ERROR.http(res.status, res.statusText),
    };
  }

  return {
    html: await res.text(),
    error: JD_FETCH_OK,
  };
}

async function resolveIcimsJobPage(
  url: string,
  signal: AbortSignal
): Promise<{
  url: string | null;
  error: JDFetchResult["error"];
}> {
  const pageUrl = new URL(url);

  if (isIcimsJobUrl(pageUrl)) {
    return {
      url: normalizeIcimsJobUrl(pageUrl.toString()),
      error: JD_FETCH_OK,
    };
  }

  const { html, error } = await fetchHtml(url, signal);

  if (!html) {
    return { url: null, error };
  }

  const iframeSrc = findIcimsJobIframeSrc(html, url);

  if (!iframeSrc) {
    return { url: null, error: JD_FETCH_ERROR.noData() };
  }

  return {
    url: normalizeIcimsJobUrl(iframeSrc),
    error: JD_FETCH_OK,
  };
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
    const location = extractLocationFromLdJsonValue(obj.jobLocation);
    const employmentType = getString(obj.employmentType);
    const datePosted = getString(obj.datePosted);
    const qualifications = htmlToText(getString(obj.qualifications));

    const text = `
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

    const normalized = normalizeRawText(text);

    if (!normalized || normalized.length < MIN_JD_LENGTH) {
      return null;
    }

    return normalized;
  } catch {
    return null;
  }
}

function extractIcimsLocationFromPage($: cheerio.CheerioAPI): string {
  const selectors = [
    ".iCIMS_JobHeader .iCIMS_JobHeaderData",
    ".iCIMS_JobHeader",
    ".iCIMS_JobContent",
    "[class*='JobHeader']",
    "[class*='job-header']",
  ];

  for (const selector of selectors) {
    const text = cleanText($(selector).first().text());
    if (!text) continue;

    // Examples:
    // UK-Remote
    // US-NC-Morrisville
    // CA-ON-Ottawa
    const locationMatch = text.match(/\b[A-Z]{2}(?:-[A-Z]{2})?-[A-Za-z0-9 .,'/()&-]+/);
    if (locationMatch?.[0]) {
      return locationMatch[0].trim();
    }

    // Sometimes remote location is rendered as just Remote
    if (/\bRemote\b/i.test(text)) {
      return "Remote";
    }
  }

  const bodyText = cleanText($("body").text());

  const bodyLocationMatch = bodyText.match(/\b[A-Z]{2}(?:-[A-Z]{2})?-[A-Za-z0-9 .,'/()&-]+/);
  if (bodyLocationMatch?.[0]) {
    return bodyLocationMatch[0].trim();
  }

  return "";
}

function extractIcimsTitleFromPage($: cheerio.CheerioAPI): string {
  const selectors = ["h1", ".iCIMS_JobHeader h1", "[class*='JobHeader'] h1"];

  for (const selector of selectors) {
    const text = cleanText($(selector).first().text());
    if (text) return text;
  }

  return "";
}

function isLikelyJDText(text: string): boolean {
  if (text.length < MIN_JD_LENGTH) return false;

  const lower = text.toLowerCase();

  return ICIMS_JD_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function extractRelevantWindow(text: string, maxChars = FALLBACK_JD_MAX_CHARS): string {
  const lower = text.toLowerCase();

  const indexes = ICIMS_JD_KEYWORDS.map((keyword) => lower.indexOf(keyword))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b);

  if (!indexes.length) {
    return text.slice(0, maxChars);
  }

  const start = Math.max(0, indexes[0] - 1_000);
  return text.slice(start, start + maxChars);
}

function withTitleAndLocation(params: { title: string; location: string; jd: string }): string {
  const { title, location, jd } = params;

  const parts = [
    title ? `Title:\n${title}` : "",
    location ? `Location:\n${location}` : "",
    `Description:\n${jd}`,
  ].filter(Boolean);

  return parts.join("\n\n");
}

function extractIcimsJD(html: string): string | null {
  const $ = cheerio.load(html);

  // 1. JSON-LD usually has the cleanest JD + location
  const ldJsonTexts = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).text())
    .get()
    .filter(Boolean);

  const structuredText = ldJsonTexts.map(extractJobPostingFromLdJson).find(Boolean);

  if (structuredText) {
    return normalizeRawText(limitRawText(structuredText));
  }

  const title = extractIcimsTitleFromPage($);
  const location = extractIcimsLocationFromPage($);

  // 2. iCIMS detail containers
  const selectors = [
    ".iCIMS_JobDescription",
    ".iCIMS_JobOverview",
    ".iCIMS_JobResponsibilities",
    ".iCIMS_JobRequirements",
    ".iCIMS_JobContent",
    "#job-description",
    "[data-automation='job-description']",
    "[class*='job-description']",
    "[class*='jobDescription']",
    "[id*='job-description']",
    "[id*='jobDescription']",
    "main",
    "article",
  ];

  for (const selector of selectors) {
    const node = $(selector).first();
    if (!node.length) continue;

    node
      .find(
        [
          "script",
          "style",
          "noscript",
          "svg",
          "img",
          "iframe",
          "link",
          "meta",
          "nav",
          "header",
          "footer",
          "aside",
          "button",
          "form",
          "select",
          "input",
          ".iCIMS_JobOptions",
          ".iCIMS_JobHeaderGroup",
          ".iCIMS_SocialOptions",
          ".iCIMS_ApplyOnlineButton",
          "[class*='simplify']",
          "[id*='simplify']",
        ].join(", ")
      )
      .remove();

    const text = normalizeRawText(node.text());

    if (text && isLikelyJDText(text)) {
      const jd = withTitleAndLocation({
        title,
        location,
        jd: text,
      });

      return normalizeRawText(limitRawText(jd));
    }
  }

  // 3. fallback body
  $("script, style, noscript, svg, img, iframe, link, meta, nav, header, footer, aside").remove();
  $("button, form, select, input").remove();
  $("[class*='simplify'], [id*='simplify']").remove();

  const bodyText = normalizeRawText($("body").text());

  if (!bodyText) {
    return null;
  }

  const relevant = normalizeRawText(extractRelevantWindow(bodyText));

  if (!relevant || relevant.length < MIN_JD_LENGTH) {
    return null;
  }

  const jd = withTitleAndLocation({
    title,
    location,
    jd: relevant,
  });

  return normalizeRawText(limitRawText(jd));
}

export async function fetchIcimsJD(
  url: string,
  signal: AbortSignal = ABORT_SIGNAL
): Promise<JDFetchResult> {
  const resolved = await resolveIcimsJobPage(url, signal);

  if (!resolved.url) {
    return {
      jd: null,
      error: resolved.error,
    };
  }

  const { html, error } = await fetchHtml(resolved.url, signal);

  if (!html) {
    return {
      jd: null,
      error,
    };
  }

  const jd = extractIcimsJD(html);

  if (!jd) {
    return {
      jd: null,
      error: JD_FETCH_ERROR.noData(),
    };
  }

  return {
    jd,
    error: JD_FETCH_OK,
  };
}
