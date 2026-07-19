import * as cheerio from "cheerio";

import { ABORT_SIGNAL } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { JDFetchResult } from "./fetch";

import {
  extractJobPostingFromJsonLd,
  extractRelevantJDWindow,
  isLikelyJDText,
  limitJDText,
} from "../text";

import { JD_FETCH_ERROR, JD_FETCH_OK } from "./fetch";

import { findIcimsIframeSrc, isIcimsUrl, normalizeIcimsUrl } from "@/modules/shared/ats/icims";
import { fetchHtmlResponse } from "@/utils/http";
import { logger } from "@/utils/logger";
import { cleanText, normalizeRawText } from "@/utils/string";

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

async function fetchHtml(
  url: string,
  signal: AbortSignal
): Promise<{
  html: string | null;
  error: JDFetchResult["error"];
}> {
  const { response, html } = await fetchHtmlResponse(url, {
    signal,
    headers: {
      "User-Agent": "Mozilla/5.0 (JD-Analyzer)",
      Accept: "text/html",
    },
  });

  if (!response.ok) {
    logger.error({ url, status: response.status }, `${RED_CROSS} Failed to fetch iCIMS JD`);

    return {
      html: null,
      error: JD_FETCH_ERROR.http(response.status, response.statusText),
    };
  }

  return {
    html,
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

  if (isIcimsUrl(pageUrl, "job")) {
    return {
      url: normalizeIcimsUrl(pageUrl.toString(), "job"),
      error: JD_FETCH_OK,
    };
  }

  const { html, error } = await fetchHtml(url, signal);

  if (!html) {
    return { url: null, error };
  }

  const iframeSrc = findIcimsIframeSrc(html, url, "job");

  if (!iframeSrc) {
    return { url: null, error: JD_FETCH_ERROR.noData() };
  }

  return {
    url: normalizeIcimsUrl(iframeSrc, "job"),
    error: JD_FETCH_OK,
  };
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

  const structuredText = ldJsonTexts
    .map((text) =>
      extractJobPostingFromJsonLd(text, {
        allowStringAddress: true,
        arraySeparator: ", ",
        convertQualificationsHtml: true,
        minLength: MIN_JD_LENGTH,
        normalize: true,
      })
    )
    .find(Boolean);

  if (structuredText) {
    return normalizeRawText(limitJDText(structuredText));
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

    if (
      text &&
      isLikelyJDText(text, {
        keywords: ICIMS_JD_KEYWORDS,
        minLength: MIN_JD_LENGTH,
      })
    ) {
      const jd = withTitleAndLocation({
        title,
        location,
        jd: text,
      });

      return normalizeRawText(limitJDText(jd));
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

  const relevant = normalizeRawText(
    extractRelevantJDWindow(bodyText, {
      keywords: ICIMS_JD_KEYWORDS,
    })
  );

  if (!relevant || relevant.length < MIN_JD_LENGTH) {
    return null;
  }

  const jd = withTitleAndLocation({
    title,
    location,
    jd: relevant,
  });

  return normalizeRawText(limitJDText(jd));
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
