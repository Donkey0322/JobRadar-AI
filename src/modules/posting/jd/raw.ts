import { RED_CROSS } from "@/constants/log";

import type { ATS } from "@/modules/employer/type";

import { fetchCustomJD } from "./custom";
import { isRetryableJDFetch, JD_FETCH_ERROR, JD_FETCH_OK, type JDFetchResult } from "./fetch";
import { fetchJDByATS } from "./registry";

import { classifyATS } from "@/modules/employer/classifier";
import { logger } from "@/utils/logger";
import { normalizeRawText } from "@/utils/string";

function finishRawJD(result: JDFetchResult): JDFetchResult {
  if (!result.jd) return result;

  const jd = normalizeRawText(result.jd);
  return { jd, error: JD_FETCH_OK };
}

const HTML_JD_SOURCES = new Set<ATS>(["custom", "lever", "phenom", "radancy"]);

export async function fetchPostingJD(url: string, signal: AbortSignal): Promise<JDFetchResult> {
  try {
    const ats = classifyATS(new URL(url));
    const result = finishRawJD(await fetchJDByATS(ats, url, signal));

    if (result.jd || HTML_JD_SOURCES.has(ats) || isRetryableJDFetch(result.error)) {
      return result;
    }

    logger.warn(
      { url, ats, code: result.error.code },
      "⚠️ ATS JD fetch failed, falling back to HTML"
    );

    return finishRawJD(await fetchCustomJD(url, signal));
  } catch (e) {
    const desc = e instanceof Error ? e.message : "Unknown fetch error";
    logger.error({ err: e, url }, `${RED_CROSS} Error fetching JD`);
    return { jd: null, error: JD_FETCH_ERROR.fetch(desc) };
  }
}
