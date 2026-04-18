import * as cheerio from "cheerio";

import { RED_CROSS } from "@/constants/log";

import type { JD, Job } from "@/types";
import type { AIResponse } from "@/validation/ai";

import { classifyATS } from "../company-tacker/ats";

import { fetchAshbyJD } from "./ats/ashby";
import { fetchGreenhouseJD, fetchSmartRecruitersJD, fetchWorkdayJD } from "./ats";

import analyzeJD from "@/modules/jd-analyzer/ai";
import { logger } from "@/utils/logger";
import { AIResponseSchema } from "@/validation/ai";

export async function getRawJD(url: string): Promise<string | null> {
  try {
    // 1. classify ATS
    const urlType = classifyATS(new URL(url));
    let text = "";

    // 2. ATS-specific handling
    switch (urlType) {
      case "greenhouse": {
        const jd = await fetchGreenhouseJD(url);
        if (!jd) return null;
        text = jd;
        break;
      }
      case "smartrecruiters": {
        const jd = await fetchSmartRecruitersJD(url);
        if (!jd) return null;
        text = jd;
        break;
      }
      case "workday": {
        const jd = await fetchWorkdayJD(url);
        if (!jd) return null;
        text = jd;
        break;
      }
      case "ashby": {
        const jd = await fetchAshbyJD(url);
        if (!jd) return null;
        text = jd;
        break;
      }

      // fallback: raw HTML scraping
      default: {
        const res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (JD-Analyzer; +https://example.local)",
          },
          // signal: AbortSignal.timeout(5000),
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

function toBoolean(v: "yes" | "no" | "unsure"): boolean | null {
  if (v === "yes") return true;
  if (v === "no") return false;
  return null;
}

function transform(response: AIResponse): JD {
  return {
    citizenship: toBoolean(response.requires_usa_citizenship),
    sponsorship: toBoolean(response.offers_visa_sponsorship),
    location: response.location,
    qualifications: response.qualifications,
    season: response.term,
  };
}

export default async function getJD(
  job: Job
): Promise<{ jd: JD | null; rawJD: string; cost: number }> {
  const rawJD = await getRawJD(job.link);

  if (rawJD) {
    const { result, cost } = await analyzeJD(rawJD);
    if (result) {
      try {
        const parsed = JSON.parse(result);
        const validated = AIResponseSchema.safeParse(parsed);
        if (validated.success) {
          return { jd: transform(validated.data), rawJD, cost };
        } else {
          logger.warn(
            { company: job.company, parsed, err: validated.error },
            "⚠️ Error parsing JSON"
          );
          return { jd: null, rawJD, cost };
        }
      } catch (e) {
        logger.warn({ company: job.company, err: e }, "⚠️ Error parsing JSON");
        return { jd: null, rawJD, cost };
      }
    }
  }
  return { jd: null, rawJD: "", cost: 0 };
}

export async function analyzeLink(link: string): Promise<JD | null> {
  const jd = await getRawJD(link);

  if (jd) {
    const { result, cost } = await analyzeJD(jd);
    if (result) {
      try {
        const parsed = JSON.parse(result);
        const validated = AIResponseSchema.safeParse(parsed);
        if (validated.success) {
          logger.info({ cost }, "💰 Analyze JD cost");
          return transform(validated.data);
        } else {
          logger.warn({ err: validated.error }, "⚠️ Error parsing JSON");
          return null;
        }
      } catch (e) {
        logger.warn({ err: e }, "⚠️ Error parsing JSON");
        return null;
      }
    }
  }
  return null;
}
