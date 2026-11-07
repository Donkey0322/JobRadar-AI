import { z } from "zod";

import { COUNTRIES } from "@/constants/country";
import { JOB_CATEGORIES, JobCategory } from "@/constants/job-category";
import { SEASONS } from "@/constants/season";

import type { JD } from "@/types/jobs";

export const SeasonSchema = z.enum(SEASONS);
export type Season = z.infer<typeof SeasonSchema>;

/** Seasons spec.txt allows per intern category; "None" is always allowed. */
const INTERN_TERMS: Partial<Record<JobCategory, readonly string[]>> = {
  [JobCategory.SUMMER_INTERN]: ["Summer"],
  [JobCategory.OFF_SEASON_INTERN]: ["Fall", "Spring", "Winter"],
};

function seasonTerm(season: string): string | null {
  return season.match(/\b(Summer|Fall|Spring|Winter)$/)?.[1] ?? null;
}

/** JD fields without cross-field rules, so callers can still `.pick` from it. */
export const JDFieldsSchema = z.object({
  citizenship: z.boolean().nullable(),
  sponsorship: z.boolean().nullable(),
  country: z.enum(COUNTRIES),
  location: z.string().nullable(),
  qualifications: z.array(z.string()).nullish(),
  category: z.enum(JOB_CATEGORIES),
  season: SeasonSchema,
});

export function checkInternSeason(
  jd: { category: JobCategory; season: string },
  ctx: z.RefinementCtx
): void {
  const allowed = INTERN_TERMS[jd.category];
  const term = seasonTerm(jd.season);

  if (allowed && term && !allowed.includes(term)) {
    ctx.addIssue({
      code: "custom",
      path: ["season"],
      message: `${jd.category} cannot have season ${jd.season}`,
    });
  }
}

export const JDResponseSchema = JDFieldsSchema.superRefine(checkInternSeason);

export type JDResponse = z.infer<typeof JDResponseSchema>;

/** spec.txt: entry, mid, and senior level roles have no season. */
export function normalizeSeason<S extends string>(category: JobCategory, season: S): S | "None" {
  return category in INTERN_TERMS ? season : SEASONS.none;
}

/**
 * A stored JD in the current shape, held to the same intern season rule as a new
 * answer. Seasons of past years stay valid. JDs written before country and category
 * existed (May 2026: location "Other", season "Senior Level") do not.
 */
const StoredJDSchema = JDFieldsSchema.extend({
  season: z.string().regex(/^(?:\d{4} (?:Summer|Fall|Spring|Winter)|None)$/),
}).superRefine(checkInternSeason);

function readStoredJD(jd: unknown): { jd: JD } | { reason: string } {
  const parsed = StoredJDSchema.safeParse(jd);

  if (!parsed.success) {
    const reason = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "jd"}: ${issue.message}`)
      .join("; ");

    return { reason };
  }

  return {
    jd: {
      ...(jd as JD),
      season: normalizeSeason(parsed.data.category, parsed.data.season) as JD["season"],
    },
  };
}

/** Returns the stored JD with its season normalized, or null when it breaks the rules. */
export function parseStoredJD(jd: unknown): JD | null {
  const parsed = readStoredJD(jd);

  return "jd" in parsed ? parsed.jd : null;
}

/** Why `parseStoredJD` rejected a value, or null when the value is valid. */
export function storedJDFailure(jd: unknown): string | null {
  const parsed = readStoredJD(jd);

  return "reason" in parsed ? parsed.reason : null;
}
