import type { JD } from "@/types/jobs";
import type { JDResponse } from "@/validation/ai";

import { JDResponseSchema } from "@/validation/ai";

export type AIJDParseResult =
  | { status: "ok"; jd: JD }
  | { status: "invalid"; parsed: unknown; error: unknown }
  | { status: "parse-error"; error: unknown };

export function normalizeJD(response: JDResponse): JD {
  return {
    citizenship: response.citizenship,
    sponsorship: response.sponsorship,
    country: response.country,
    location: response.location,
    qualifications: response.qualifications,
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
