import * as cheerio from "cheerio";

import { CONFIG } from "@/constants";
import { RED_CROSS } from "@/constants/log";

import type { JD, Job } from "@/types/jobs";
import type { JDResponse } from "@/validation/ai";

import { classifyATS } from "../company-tacker/ats";

import analyzeJD from "./ai";
import {
  fetchAshbyJD,
  fetchGreenhouseJD,
  fetchOracleJD,
  fetchSmartRecruitersJD,
  fetchWorkdayJD,
} from "./ats";

import { logger } from "@/utils/logger";
import { JDResponseSchema } from "@/validation/ai";

export function normalizeJD(response: JDResponse): JD {
  return {
    citizenship: response.citizenship,
    sponsorship: response.sponsorship,
    country: response.country,
    qualifications: response.qualifications,
    category: response.category,
    season: response.season,
  };
}

export function isEligibleJD(jd: JD) {
  const filters = CONFIG.target.filter;
  const countries = CONFIG.target.countries;

  if (!countries.includes(jd.country)) {
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

export async function getRawJD(url: string, signal: AbortSignal): Promise<string | null> {
  try {
    // 1. classify ATS
    const urlType = classifyATS(new URL(url));
    let text = "";

    // 2. ATS-specific handling
    switch (urlType) {
      case "greenhouse": {
        const jd = await fetchGreenhouseJD(url, signal);
        if (!jd) return null;
        text = jd;
        break;
      }
      case "smartrecruiters": {
        const jd = await fetchSmartRecruitersJD(url, signal);
        if (!jd) return null;
        text = jd;
        break;
      }
      case "workday": {
        const jd = await fetchWorkdayJD(url, signal);
        if (!jd) return null;
        text = jd;
        break;
      }
      case "ashby": {
        const jd = await fetchAshbyJD(url, signal);
        if (!jd) return null;
        text = jd;
        break;
      }
      case "oraclecloud": {
        const jd = await fetchOracleJD(url, signal);
        if (!jd) return null;
        text = jd;
        break;
      }
      // fallback: raw HTML scraping
      default: {
        const res = await fetch(url, {
          signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (JD-Analyzer)",
          },
        });

        if (!res.ok) {
          logger.error({ url }, `${RED_CROSS} Failed to fetch text`);
          return null;
        }

        const html = await res.text();
        const $ = cheerio.load(html);

        const script = $('script[type="application/ld+json"]').first();

        if (script.length) {
          text = script.text() + "\n" + $.root().text();
        } else {
          text = $("body").text();
        }

        break;
      }
    }

    // normalize text
    const lines = text
      .split("\n")
      .map((ln) => ln.replace(/\s+/g, " ").trim())
      .filter((ln) => ln.length > 0);

    return lines.length ? lines.join("\n") : null;
  } catch (e) {
    logger.error({ err: e, url }, `${RED_CROSS} Error fetching JD`);
    return null;
  }
}

export default async function getJD(job: Job): Promise<{
  jd: JD | null;
  rawJD: string;
  cost: number;
}> {
  // five minutes timeout
  const signal = AbortSignal.timeout(5 * 60 * 1000);
  const rawJD = await getRawJD(job.link, signal);

  if (!rawJD) {
    return {
      jd: null,
      rawJD: "",
      cost: 0,
    };
  }

  const { result, cost } = await analyzeJD(rawJD);

  if (!result) {
    return {
      jd: null,
      rawJD,
      cost,
    };
  }

  try {
    const parsed = JSON.parse(result);
    const validated = JDResponseSchema.safeParse(parsed);
    if (!validated.success) {
      logger.warn(
        {
          company: job.company,
          parsed,
          err: validated.error,
        },
        "⚠️ Invalid AI response"
      );

      return {
        jd: null,
        rawJD,
        cost,
      };
    }

    const jd = normalizeJD(validated.data);
    return {
      jd,
      rawJD,
      cost,
    };
  } catch (e) {
    logger.warn(
      {
        company: job.company,
        err: e,
      },
      "⚠️ Error parsing AI response"
    );

    return {
      jd: null,
      rawJD,
      cost,
    };
  }
}

export async function analyzeLink(link: string): Promise<JD | null> {
  const signal = AbortSignal.timeout(5000);
  const rawJD = await getRawJD(link, signal);

  if (!rawJD) {
    return null;
  }

  const { result } = await analyzeJD(rawJD);

  if (!result) {
    return null;
  }

  try {
    const parsed = JSON.parse(result);
    const validated = JDResponseSchema.safeParse(parsed);

    if (!validated.success) {
      logger.warn(
        {
          err: validated.error,
        },
        "⚠️ Invalid AI response"
      );

      return null;
    }

    return normalizeJD(validated.data);
  } catch (e) {
    logger.warn({ err: e }, "⚠️ Error parsing AI response");
    return null;
  }
}
