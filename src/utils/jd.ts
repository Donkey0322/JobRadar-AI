import * as cheerio from "cheerio";

import type { JD, Job } from "@/types";
import type { AIResponse } from "@/validation/ai";

import { saveJd } from "./data";

import analyze from "@/utils/ai";
import { AIResponseSchema } from "@/validation/ai";

type JobPlatform = "greenhouse" | "workday" | "smartrecruiters" | "oraclecloud" | "unknown";

async function getJD(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (JD-Analyzer; +https://example.local)" },
  });
  if (!resp.ok) {
    console.error(`Failed to fetch text from ${url}`);
    return "";
  }
  const text = await resp.text();
  return text;
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
        const u = new URL(url);
        const jobId = u.searchParams.get("gh_jid");

        // embed greenhouse
        if (jobId) {
          const companyMatch = html.match(
            /boards\.greenhouse\.io\/embed\/job_board\/js\?for=([a-z0-9]+)/i
          );

          const company = companyMatch?.[1];
          if (!company) return null;

          const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${company}/jobs/${jobId}`;
          const res = await fetch(apiUrl);
          if (!res.ok) return null;

          const data = await res.json();
          text = JSON.stringify(data);
          break;
        }

        // normal greenhouse
        const jd = $("div.job__description.body").first();
        if (!jd.length) return null;

        jd.find("meta.job__pay-ranges").remove();
        text = jd.text();
        break;
      }
      case "workday":
      case "smartrecruiters": {
        const meta = $('meta[property="og:description"]').first();
        if (!meta.length) return null;

        text = meta.attr("content") ?? "";
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

export function detectPlatform(url: string): JobPlatform {
  try {
    const u = new URL(url);
    const host = u.hostname;

    if (u.searchParams.get("gh_jid")) return "greenhouse";

    if (host.includes("greenhouse")) return "greenhouse";
    if (host.includes("workday")) return "workday";
    if (host.includes("smartrecruiters")) return "smartrecruiters";
    if (host.includes("oraclecloud")) return "oraclecloud";

    return "unknown";
  } catch {
    return "unknown";
  }
}

export default async function analyzeJD(job: Job): Promise<JD | null> {
  const html = await getJD(job.link);
  const urlType = detectPlatform(job.link);
  const jdText = await visibleTextFromHtml(html, urlType, job.link);

  if (jdText) {
    await saveJd(jdText, job);
    const aiResponse = await analyze(jdText);
    if (aiResponse) {
      try {
        const parsed = JSON.parse(aiResponse);
        const validated = AIResponseSchema.parse(parsed);
        return transform(validated);
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
  const urlType = detectPlatform(link);
  const jdText = await visibleTextFromHtml(html, urlType, link);

  if (jdText) {
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
