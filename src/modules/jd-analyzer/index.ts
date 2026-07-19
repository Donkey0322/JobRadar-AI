import { ALLOWED_COUNTRIES, CONFIG } from "@/constants";
import { ABORT_SIGNAL } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { JDFetchResult, JDFetchStatus } from "./ats";
import type { JD, Job } from "@/types/jobs";

import { classifyATS } from "../company-tacker/ats";

import analyzeJD from "./ai";
import {
  fetchAshbyJD,
  fetchCustomJD,
  fetchEightfoldJD,
  fetchGreenhouseJD,
  fetchIcimsJD,
  fetchOracleJD,
  fetchSmartRecruitersJD,
  fetchWorkdayJD,
  JD_FETCH_ERROR,
  JD_FETCH_OK,
} from "./ats";
import { parseAIJDResult } from "./response";

import { logger } from "@/utils/logger";
import { normalizeRawText } from "@/utils/string";

export { normalizeJD } from "./response";

export function isEligibleJD(jd: JD) {
  const filters = CONFIG.target.filter;

  if (ALLOWED_COUNTRIES.size > 0 && !ALLOWED_COUNTRIES.has(jd.country)) {
    return [false, `${jd.country} is not in the allowed countries`];
  }

  const allowedCategories = new Set([
    ...(CONFIG.target?.intern ?? []),
    ...(CONFIG.target?.["full-time"] ?? []),
  ]);
  if (jd.category && !allowedCategories.has(jd.category)) {
    return [false, `${jd.category} is not in the allowed categories`];
  }

  if (!filters) {
    return [true, null];
  }

  const rule = filters[jd.country];

  // no rule for this country, so it's eligible
  if (!rule) {
    return [true, null];
  }

  if (rule.allow_citizenship_required === false && jd.citizenship === true) {
    return [false, "citizenship is required"];
  }

  if (rule.allow_no_sponsorship === false && jd.sponsorship === false) {
    return [false, "sponsorship is not available"];
  }
  return [true, null];
}

function finishRawJD(result: JDFetchResult): JDFetchResult {
  if (!result.jd) return result;

  const jd = normalizeRawText(result.jd);
  return { jd, error: JD_FETCH_OK };
}

export async function getRawJD(
  url: string,
  signal: AbortSignal = ABORT_SIGNAL
): Promise<JDFetchResult> {
  try {
    const urlType = classifyATS(new URL(url));

    switch (urlType) {
      case "ashby":
        return finishRawJD(await fetchAshbyJD(url, signal));
      case "eightfold":
        return finishRawJD(await fetchEightfoldJD(url, signal));
      case "greenhouse":
        return finishRawJD(await fetchGreenhouseJD(url, signal));
      case "icims":
        return finishRawJD(await fetchIcimsJD(url, signal));
      case "oraclecloud":
        return finishRawJD(await fetchOracleJD(url, signal));
      case "smartrecruiters":
        return finishRawJD(await fetchSmartRecruitersJD(url, signal));
      case "workday":
        return finishRawJD(await fetchWorkdayJD(url, signal));
      default:
        return finishRawJD(await fetchCustomJD(url, signal));
    }
  } catch (e) {
    const desc = e instanceof Error ? e.message : "Unknown fetch error";
    logger.error({ err: e, url }, `${RED_CROSS} Error fetching JD`);
    return { jd: null, error: JD_FETCH_ERROR.fetch(desc) };
  }
}

export default async function getJD(job: Job): Promise<{
  jd: JD | null;
  rawJD: string;
  cost: number;
  error: JDFetchStatus;
}> {
  // five minutes timeout
  const signal = AbortSignal.timeout(5 * 60 * 1000);
  const { jd: rawJD, error } = await getRawJD(job.link, signal);

  if (!rawJD) {
    return {
      jd: null,
      rawJD: "",
      cost: 0,
      error,
    };
  }

  const { result, cost } = await analyzeJD(rawJD);

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

export async function analyzeLink(link: string): Promise<JD | null> {
  const signal = AbortSignal.timeout(5000);
  const { jd: rawJD } = await getRawJD(link, signal);

  if (!rawJD) {
    return null;
  }

  const { result } = await analyzeJD(rawJD);

  if (!result) {
    return null;
  }

  const parsedResult = parseAIJDResult(result);

  if (parsedResult.status === "ok") {
    return parsedResult.jd;
  }

  logger.warn(
    { err: parsedResult.error },
    parsedResult.status === "invalid" ? "⚠️ Invalid AI response" : "⚠️ Error parsing AI response"
  );
  return null;
}
