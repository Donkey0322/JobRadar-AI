import type { JD } from "@/types/jobs";
import type { JDResponse } from "@/validation/ai";

import { cleanText } from "@/utils/string";
import { JDResponseSchema } from "@/validation/ai";

const AI_TEXT_LEAK_MARKERS = [
  "---END JD TEXT---",
  "---BEGIN JD TEXT---",
  "---JOB_DESCRIPTION",
  "JSON parse error",
  "continued in the next message",
];

const MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December";

export type AIJDParseResult =
  | { status: "ok"; jd: JD }
  | { status: "invalid"; parsed: unknown; error: unknown }
  | { status: "parse-error"; error: unknown };

function cutLeakMarkers(value: string): string {
  let text = value;

  for (const marker of AI_TEXT_LEAK_MARKERS) {
    const index = text.indexOf(marker);

    if (index >= 0) {
      text = text.slice(0, index);
    }
  }

  return text;
}

function isSpill(suffix: string): boolean {
  const text = suffix.trim();

  if (!text) return true;
  if (text.length > 400) return true;
  if (/<[a-z!/]/i.test(text)) return true;
  if (/https?:\/\//i.test(text)) return true;
  if (/\b(I am an LLM|I will be the one|I cannot)\b/i.test(text)) return true;

  return false;
}

function isContinuation(suffix: string): boolean {
  const text = suffix.trim();

  if (isSpill(text)) return false;

  return (
    /^R?['’]s\b/.test(text) ||
    /^s degree\b/i.test(text) ||
    /^or\b/i.test(text) ||
    /^\d/.test(text) ||
    new RegExp(`^(?:${MONTHS})\\b`).test(text) ||
    /^[-‐‑–—]/.test(text)
  );
}

function joinContinuation(prefix: string, suffix: string): string {
  let pre = prefix.replace(/\nR\s*$/, "");
  let suf = suffix.trim();

  if (/^R['’]s\b/.test(suf)) {
    pre = pre.replace(/R$/, "");
    suf = suf.slice(1);
  } else if (/^['’]s\b/.test(suf)) {
    pre = pre.replace(/R$/, "");
  }

  if (/^s degree\b/i.test(suf)) {
    suf = `'${suf}`;
  }

  if (/^['’]s\b/.test(suf) || /^[-‐‑–—]/.test(suf)) {
    return `${pre}${suf}`;
  }

  if (/\d$/.test(pre.trim()) && /^\d/.test(suf)) {
    return `${pre.trimEnd()}-${suf}`;
  }

  if (new RegExp(`\\d{4}\\s*$`).test(pre) && new RegExp(`^(?:${MONTHS})\\b`).test(suf)) {
    return `${pre.trimEnd()} - ${suf}`;
  }

  return `${pre.trimEnd()} ${suf}`;
}

function trimDanglingFragment(prefix: string): string {
  return prefix.replace(/\nR\s*$/, "").replace(/\n[A-Z][^\n]{0,40}$/, "");
}

/**
 * Model strings sometimes insert a blank-line run in the middle of a
 * qualification, then either continue the sentence or paste prompt leftovers.
 * Keep a real continuation. Drop the spill.
 */
function stripSpills(value: string): string {
  const text = cutLeakMarkers(value);
  const newlineRun = text.search(/\n{3,}/);

  if (newlineRun < 0) {
    return text;
  }

  const prefix = text.slice(0, newlineRun).replace(/\nR\s*$/, "");
  const suffix = text.slice(newlineRun).replace(/^\n+/, "");

  if (!isContinuation(suffix)) {
    return trimDanglingFragment(prefix);
  }

  return stripSpills(joinContinuation(prefix, suffix));
}

export function cleanAIString(value: string): string {
  return cleanText(stripSpills(value));
}

function droppedNewlineSpill(text: string): boolean {
  const newlineRun = text.search(/\n{3,}/);

  if (newlineRun < 0) {
    return false;
  }

  const prefix = text.slice(0, newlineRun).replace(/\nR\s*$/, "");
  const suffix = text.slice(newlineRun).replace(/^\n+/, "");

  if (!suffix.trim()) {
    return false;
  }

  if (!isContinuation(suffix)) {
    return true;
  }

  return droppedNewlineSpill(joinContinuation(prefix, suffix));
}

function droppedSpill(value: string): boolean {
  const cut = cutLeakMarkers(value);

  if (cut !== value && value.slice(cut.length).trim().length > 0) {
    return true;
  }

  return droppedNewlineSpill(cut);
}

export function jdResponseSpilled(result: string): boolean {
  try {
    const parsed = JSON.parse(result) as {
      location?: unknown;
      qualifications?: unknown;
    };
    const fields: string[] = [];

    if (typeof parsed.location === "string") {
      fields.push(parsed.location);
    }

    if (Array.isArray(parsed.qualifications)) {
      for (const item of parsed.qualifications) {
        if (typeof item === "string") {
          fields.push(item);
        }
      }
    }

    return fields.some(droppedSpill);
  } catch {
    return false;
  }
}

function cleanAIStringOrNull(value: string | null): string | null {
  if (value == null) return null;

  const cleaned = cleanAIString(value);

  return cleaned.length > 0 ? cleaned : null;
}

export function normalizeJD(response: JDResponse): JD {
  return {
    citizenship: response.citizenship,
    sponsorship: response.sponsorship,
    country: response.country,
    location: cleanAIStringOrNull(response.location),
    qualifications: response.qualifications.map(cleanAIString).filter((item) => item.length > 0),
    category: response.category,
    season: response.season,
  };
}

export function parseAIJDResult(result: string): AIJDParseResult {
  try {
    const parsed: unknown = JSON.parse(result);
    const validated = JDResponseSchema.safeParse(parsed);

    if (!validated.success) {
      return { status: "invalid", parsed, error: validated.error };
    }

    return { status: "ok", jd: normalizeJD(validated.data) };
  } catch (error) {
    return { status: "parse-error", error };
  }
}
