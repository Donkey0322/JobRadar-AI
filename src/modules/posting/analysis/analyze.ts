import type { JDFetchResult, JDFetchStatus } from "../jd/fetch";
import type { JD, Job } from "@/types/jobs";

import { JD_FETCH_OK } from "../jd/fetch";

import analyzeJD, { analyzeQualifications } from "./ai";
import { parseAIJDResult, parseQualificationResult } from "./response";

import { logger } from "@/utils/logger";

export { normalizeJD } from "./response";

export type AIAnalysisFailureReason = "empty" | "invalid" | "unparseable";

export type PostingAnalysisFailure =
  | { stage: "fetch"; error: JDFetchStatus }
  | { stage: "ai"; reason: AIAnalysisFailureReason };

export interface PostingAnalysisResult {
  jd: JD | null;
  rawJD: string;
  cost: number;
  /** Status of the JD fetch; stays OK when only the AI step fails. */
  error: JDFetchStatus;
  failure: PostingAnalysisFailure | null;
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

export async function analyzePosting(
  job: Job,
  fetched: JDFetchResult
): Promise<PostingAnalysisResult> {
  const { jd: rawJD, error } = fetched;

  if (!rawJD) {
    return {
      jd: null,
      rawJD: "",
      cost: 0,
      error,
      failure: { stage: "fetch", error },
    };
  }

  const { result, cost } = await analyzeJD(rawJD, true, job.location);

  if (!result) {
    return {
      jd: null,
      rawJD,
      cost,
      error: JD_FETCH_OK,
      failure: { stage: "ai", reason: "empty" },
    };
  }

  const parsedResult = parseAIJDResult(result);

  if (parsedResult.status === "ok") {
    return {
      jd: parsedResult.jd,
      rawJD,
      cost,
      error: JD_FETCH_OK,
      failure: null,
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
      error: JD_FETCH_OK,
      failure: { stage: "ai", reason: "invalid" },
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
    error: JD_FETCH_OK,
    failure: { stage: "ai", reason: "unparseable" },
  };
}

export default analyzePosting;
