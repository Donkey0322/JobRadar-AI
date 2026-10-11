import { ABORT_SIGNAL } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { JDFetchResult, JDFetchStatus } from "@/modules/employer/detail";
import type { ATS } from "@/modules/employer/type";
import type { JD, Job } from "@/types/jobs";

import analyzeJD, { analyzeQualifications } from "./ai";
import { parseAIJDResult, parseQualificationResult } from "./response";

import { classifyATS } from "@/modules/employer/classifier";
import {
  isRetryableJDFetch,
  JD_FETCH_ERROR,
  JD_FETCH_OK,
} from "@/modules/employer/detail/fetch";
import { logger } from "@/utils/logger";
import { normalizeRawText } from "@/utils/string";

export { normalizeJD } from "./response";

export interface PostingAnalysisResult {
  jd: JD | null;
  rawJD: string;
  cost: number;
  error: JDFetchStatus;
}

export interface QualificationAnalysisResult {
  qualifications: string[] | null;
  cost: number;
}

export async function extractQualifications(rawJD: string): Promise<QualificationAnalysisResult> {
  const second = await analyzeQualifications(rawJD);
  const qualifications = second.result ? parseQualificationResult(second.result) : null;

  if (!qualifications) {
    logger.warn("⚠️ Qualification extraction failed");
  }

  return { qualifications, cost: second.cost };
}

function finishRawJD(result: JDFetchResult): JDFetchResult {
  if (!result.jd) return result;

  const jd = normalizeRawText(result.jd);
  return { jd, error: JD_FETCH_OK };
}

const HTML_JD_SOURCES = new Set<ATS>(["custom", "lever", "phenom", "radancy"]);

export async function getRawJD(
  url: string,
  signal: AbortSignal = ABORT_SIGNAL
): Promise<JDFetchResult> {
  const [{ employers }, { fetchCustomJD }] = await Promise.all([
    import("@/modules/employer"),
    import("@/modules/employer/detail"),
  ]);

  try {
    const ats = classifyATS(new URL(url));
    const result = finishRawJD(await employers[ats].fetchJD(url, signal));

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

export async function analyzePosting(
  job: Job,
  fetched?: JDFetchResult
): Promise<PostingAnalysisResult> {
  const { jd: rawJD, error } =
    fetched ?? (await getRawJD(job.link, AbortSignal.timeout(5 * 60 * 1000)));

  if (!rawJD) {
    return {
      jd: null,
      rawJD: "",
      cost: 0,
      error,
    };
  }

  const { result, cost } = await analyzeJD(rawJD, true, job.location);

  if (!result) {
    return {
      jd: null,
      rawJD,
      cost,
      error: JD_FETCH_ERROR.noData(),
    };
  }

  const parsedResult = parseAIJDResult(result);

  if (parsedResult.status === "ok") {
    return {
      jd: parsedResult.jd,
      rawJD,
      cost,
      error: JD_FETCH_OK,
    };
  }

  if (parsedResult.status === "invalid") {
    logger.warn(
      {
        company: job.company,
        parsed: parsedResult.parsed,
        err: parsedResult.error,
      },
      "⚠️ Invalid AI response"
    );

    return {
      jd: null,
      rawJD,
      cost,
      error: JD_FETCH_ERROR.noData(),
    };
  }

  logger.warn(
    {
      company: job.company,
      err: parsedResult.error,
    },
    "⚠️ Error parsing AI response"
  );

  return {
    jd: null,
    rawJD,
    cost,
    error: JD_FETCH_ERROR.internal(),
  };
}

export default analyzePosting;
