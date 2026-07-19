import { htmlToText, normalizeRawText } from "@/utils/string";

export const DEFAULT_JD_MAX_CHARS = 12_000;

export interface JDTextMatchOptions {
  keywords: readonly string[];
  minLength: number;
}

export interface JDTextWindowOptions {
  keywords: readonly string[];
  maxChars?: number;
}

export interface JobPostingJsonLdOptions {
  allowStringAddress?: boolean;
  arraySeparator?: string;
  convertQualificationsHtml?: boolean;
  minLength?: number;
  normalize?: boolean;
}

function getString(value: unknown, arraySeparator: string): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "string").join(arraySeparator);
  }
  return "";
}

function extractLocation(
  value: unknown,
  options: Pick<JobPostingJsonLdOptions, "allowStringAddress" | "arraySeparator">
): string {
  if (!value) return "";

  const { allowStringAddress = false, arraySeparator = ", " } = options;
  const locations = Array.isArray(value) ? value : [value];

  return locations
    .map((location) => {
      if (!location || typeof location !== "object") return "";

      const address = (location as Record<string, unknown>).address;

      if (allowStringAddress && typeof address === "string") {
        return address;
      }

      if (!address || typeof address !== "object") return "";

      const addressObject = address as Record<string, unknown>;

      return [
        getString(addressObject.addressLocality, arraySeparator),
        getString(addressObject.addressRegion, arraySeparator),
        getString(addressObject.addressCountry, arraySeparator),
      ]
        .filter(Boolean)
        .join(", ");
    })
    .filter(Boolean)
    .join(" | ");
}

export function limitJDText(text: string, maxChars = DEFAULT_JD_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[TRUNCATED]`;
}

export function isLikelyJDText(text: string, options: JDTextMatchOptions): boolean {
  if (text.length < options.minLength) return false;

  const lower = text.toLowerCase();
  return options.keywords.some((keyword) => lower.includes(keyword));
}

export function extractRelevantJDWindow(text: string, options: JDTextWindowOptions): string {
  const { keywords, maxChars = DEFAULT_JD_MAX_CHARS } = options;
  const lower = text.toLowerCase();
  const indexes = keywords
    .map((keyword) => lower.indexOf(keyword))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b);

  if (!indexes.length) {
    return text.slice(0, maxChars);
  }

  const start = Math.max(0, indexes[0] - 1_000);
  return text.slice(start, start + maxChars);
}

export function extractJobPostingFromJsonLd(
  raw: string,
  options: JobPostingJsonLdOptions = {}
): string | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    const nodes = Array.isArray(parsed) ? parsed : [parsed];
    const jobPosting = nodes.find((node) => {
      if (!node || typeof node !== "object") return false;

      const type = (node as Record<string, unknown>)["@type"];
      return type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
    });

    if (!jobPosting || typeof jobPosting !== "object") {
      return null;
    }

    const {
      arraySeparator = ", ",
      convertQualificationsHtml = false,
      minLength = 0,
      normalize = false,
    } = options;
    const object = jobPosting as Record<string, unknown>;
    const stringValue = (value: unknown) => getString(value, arraySeparator);
    const qualificationsValue = stringValue(object.qualifications);
    const qualifications = convertQualificationsHtml
      ? htmlToText(qualificationsValue)
      : qualificationsValue;

    const text = `
Title:
${stringValue(object.title)}

Location:
${extractLocation(object.jobLocation, options)}

Employment Type:
${stringValue(object.employmentType)}

Date Posted:
${stringValue(object.datePosted)}

Description:
${htmlToText(stringValue(object.description))}

Qualifications:
${qualifications}
`;

    const result = normalize ? normalizeRawText(text) : text;
    if (!result || result.length < minLength) {
      return null;
    }

    return result;
  } catch {
    return null;
  }
}
