import * as cheerio from "cheerio";

import { ABORT_SIGNAL } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { JDFetchResult } from "../index";

import {
  extractJobPostingFromJsonLd,
  extractRelevantJDWindow,
  isLikelyJDText,
  limitJDText,
} from "../../text";
import { JD_FETCH_ERROR, JD_FETCH_OK } from "../index";

import { fetchAppleJD } from "./apple";
import { fetchNetflixJD } from "./netflix";

import { parseCustomCompanyIdentifier } from "@/modules/company-tacker/ats/custom";
import { logger } from "@/utils/logger";
import { normalizeRawText } from "@/utils/string";

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

function extractFallbackJD(html: string): string | null {
  const $ = cheerio.load(html);

  const ldJsonTexts = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).text())
    .get()
    .filter(Boolean);
  const structuredText = ldJsonTexts
    .map((text) =>
      extractJobPostingFromJsonLd(text, {
        allowStringAddress: false,
        arraySeparator: ", ",
        convertQualificationsHtml: false,
      })
    )
    .find(Boolean);

  if (structuredText) {
    return normalizeRawText(limitJDText(structuredText));
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

    if (
      text &&
      isLikelyJDText(text, {
        keywords: JD_KEYWORDS,
        minLength: 300,
      })
    ) {
      return limitJDText(text);
    }
  }

  const bodyText = normalizeRawText($("body").text());

  if (!bodyText) {
    return null;
  }

  return normalizeRawText(
    limitJDText(
      extractRelevantJDWindow(bodyText, {
        keywords: JD_KEYWORDS,
      })
    )
  );
}

export async function fetchCustomJD(
  url: string,
  signal: AbortSignal = ABORT_SIGNAL
): Promise<JDFetchResult> {
  const identifier = parseCustomCompanyIdentifier(new URL(url));

  try {
    switch (identifier) {
      case "apple": {
        return await fetchAppleJD(url, signal);
      }
      case "netflix": {
        return await fetchNetflixJD(url, signal);
      }
      // TODO: meta, google, amazon
      default: {
        const res = await fetch(url, {
          signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (JD-Analyzer)",
            "Accept-Encoding": "identity",
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

        if (jd?.toLowerCase().includes("not found")) {
          return { jd: null, error: JD_FETCH_ERROR.noData() };
        }

        return { jd, error: JD_FETCH_OK };
      }
    }
  } catch (e) {
    return {
      jd: null,
      error: JD_FETCH_ERROR.fetch(e instanceof Error ? e.message : "Unknown fetch error"),
    };
  }
}
