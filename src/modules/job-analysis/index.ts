import { ALLOWED_COUNTRIES, CONFIG } from "@/constants";
import { ABORT_SIGNAL } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { JDFetchResult, JDFetchStatus } from "@/modules/ats/detail";
import type { ATS } from "@/modules/ats/type";
import type { JD, Job } from "@/types/jobs";

import analyzeJD, { analyzeQualifications } from "./ai";
import { parseAIJDResult, parseQualificationResult } from "./response";

import { classifyATS, employers } from "@/modules/ats/core";
import { isNotifyCandidate } from "@/modules/ats/core/filter";
import {
  fetchCustomJD,
  isRetryableJDFetch,
  JD_FETCH_ERROR,
  JD_FETCH_OK,
} from "@/modules/ats/detail";
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

  const rules = [];

  if (jd.country === "Unsure") {
    for (const country of CONFIG.target.countries) {
      const rule = filters[country];
      if (rule) {
        rules.push(rule);
      }
    }
  } else {
    const rule = filters[jd.country];
    if (rule) {
      rules.push(rule);
    }
  }

  // no rule for this country, so it's eligible
  if (rules.length === 0) {
    return [true, null];
  }

  for (const rule of rules) {
    if (rule.allow_citizenship_required === false && jd.citizenship === true) {
      return [false, "citizenship is required"];
    }

    if (rule.allow_no_sponsorship === false && jd.sponsorship === false) {
      return [false, "sponsorship is not available"];
    }
  }

  return [true, null];
}

export function decideNotification(role: string, jd: JD) {
  const [eligible, reason] = isEligibleJD(jd);

  if (!eligible) {
    return {
      action: "skip" as const,
      kind: "ineligible" as const,
      reason: typeof reason === "string" ? reason : null,
    };
  }

  if (!isNotifyCandidate(role)) {
    return {
      action: "skip" as const,
      kind: "dashboard" as const,
      reason: null,
    };
  }

  return { action: "notify" as const, kind: null, reason: null };
}

export function needsQualificationExtraction(jd: JD, role?: string) {
  if (jd.qualifications != null) {
    return false;
  }

  const [eligible] = isEligibleJD(jd);

  if (!eligible) {
    return false;
  }

  if (role !== undefined && !isNotifyCandidate(role)) {
    return false;
  }

  return true;
}

export async function attachQualifications(rawJD: string, jd: JD, cost: number, role?: string) {
  if (!needsQualificationExtraction(jd, role)) {
    return { jd, cost };
  }

  const second = await analyzeQualifications(rawJD);
  const qualifications = second.result ? parseQualificationResult(second.result) : null;

  if (!qualifications) {
    logger.warn("⚠️ Qualification extraction failed");
    return { jd, cost: cost + second.cost };
  }

  return {
    jd: { ...jd, qualifications },
    cost: cost + second.cost,
  };
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
    const finished = await attachQualifications(rawJD, parsedResult.jd, cost, job.role);

    return {
      jd: finished.jd,
      rawJD,
      cost: finished.cost,
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
    const finished = await attachQualifications(rawJD, parsedResult.jd, 0);
    return finished.jd;
  }

  logger.warn(
    { err: parsedResult.error },
    parsedResult.status === "invalid" ? "⚠️ Invalid AI response" : "⚠️ Error parsing AI response"
  );
  return null;
}
