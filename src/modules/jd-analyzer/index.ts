import * as cheerio from "cheerio";

import type { JD, Job } from "@/types";
import type { AIResponse } from "@/validation/ai";

import { classifyATS } from "../company-tacker/ats";

import { fetchAshbyJD } from "./ats/ashby";
import { fetchGreenhouseJD, fetchSmartRecruitersJD, fetchWorkdayJD } from "./ats";

import analyze from "@/modules/jd-analyzer/ai";
import { AIResponseSchema } from "@/validation/ai";

export async function getJD(url: string): Promise<string | null> {
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
          console.error(`Failed to fetch text from ${url}`);
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
    console.warn(`[warn] Error fetching JD from ${url}: ${e}`);
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

export default async function analyzeJD(job: Job): Promise<{ jd: JD; plainText: string } | null> {
  const jd = await getJD(job.link);

  if (jd) {
    const aiResponse = await analyze(jd);
    if (aiResponse) {
      try {
        const parsed = JSON.parse(aiResponse);
        const validated = AIResponseSchema.safeParse(parsed);
        if (validated.success) {
          return { jd: transform(validated.data), plainText: jd };
        } else {
          console.warn(`[${job.company}] Error parsing JSON: ${parsed}, error: ${validated.error}`);
          return null;
        }
      } catch (e) {
        console.warn(`[${job.company}] Error parsing JSON: ${e}`);
        return null;
      }
    }
  }
  return null;
}

export async function analyzeLink(link: string): Promise<JD | null> {
  const jd = await getJD(link);

  if (jd) {
    const aiResponse = await analyze(jd);
    if (aiResponse) {
      try {
        const parsed = JSON.parse(aiResponse);
        const validated = AIResponseSchema.safeParse(parsed);
        if (validated.success) {
          return transform(validated.data);
        } else {
          console.log("parsed", parsed);
          console.warn(`Error parsing JSON:, error: ${validated.error}`);
          return null;
        }
      } catch (e) {
        console.warn(`Error parsing JSON: ${e}`);
        return null;
      }
    }
  }
  return null;
}
