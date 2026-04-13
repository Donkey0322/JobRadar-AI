import * as cheerio from "cheerio";

import type { JD, Job } from "@/types";
import type { AIResponse } from "@/validation/ai";

import { saveJd } from "../../utils/data";
import { classifyATS } from "../company-tacker/ats";

import { fetchGreenhouseJD, fetchSmartRecruitersJD, fetchWorkdayJD } from "./ats";

import analyze from "@/modules/jd-analyzer/ai";
import { AIResponseSchema } from "@/validation/ai";

async function getJD(url: string): Promise<string> {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (JD-Analyzer; +https://example.local)" },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      console.error(`Failed to fetch text from ${url}`);
      return "";
    }
    const text = await resp.text();
    return text;
  } catch (e) {
    console.warn(`[warn] Error fetching html from ${url}: ${e}`);
    return "";
  }
}

async function visibleTextFromHtml(
  html: string,
  urlType: string,
  url: string
): Promise<string | null> {
  if (!html) return null;

  const $ = cheerio.load(html);

  try {
    let text = "";

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
      default: {
        const script = $('script[type="application/ld+json"]').first();
        if (script.length) {
          text = script.text() + "\n" + $.root().text();
        } else {
          text = $("body").text();
        }
        break;
      }
    }

    const lines = text
      .split("\n")
      .map((ln) => ln.replace(/\s+/g, " ").trim())
      .filter((ln) => ln.length > 0);

    return lines.length ? lines.join("\n") : null;
  } catch (e) {
    console.warn(`[warn] Error extracting text: ${e}`);
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

export default async function analyzeJD(job: Job): Promise<JD | null> {
  const html = await getJD(job.link);
  const urlType = classifyATS(new URL(job.link));
  const jdText = await visibleTextFromHtml(html, urlType, job.link);

  if (jdText) {
    await saveJd(jdText, job);
    const aiResponse = await analyze(jdText);
    if (aiResponse) {
      try {
        const parsed = JSON.parse(aiResponse);
        const validated = AIResponseSchema.safeParse(parsed);
        if (validated.success) {
          return transform(validated.data);
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
  const html = await getJD(link);
  const urlType = classifyATS(new URL(link));
  const jdText = await visibleTextFromHtml(html, urlType, link);

  if (jdText) {
    // await fs.writeFile("jd.txt", html, "utf-8");
    const aiResponse = await analyze(jdText);
    if (aiResponse) {
      try {
        const parsed = JSON.parse(aiResponse);
        const validated = AIResponseSchema.parse(parsed);
        return transform(validated);
      } catch (e) {
        throw new Error(`Error parsing JSON: ${e}`, { cause: e });
      }
    }
  }
  return null;
}
