import type { COUNTRIES } from "@/constants/country";
import type { JobCategory } from "@/constants/job-category";
import type { Season } from "@/constants/season";

/** Parsed by AI from the job description. */
export interface JD {
  citizenship: boolean | null;
  sponsorship: boolean | null;
  qualifications: string[] | null;
  country: (typeof COUNTRIES)[number];
  location: string | null;
  category: JobCategory;
  // None for entry level, mid level, and senior level, and when no season is found.
  season: Season;
}

export interface Job {
  id?: number;
  company: string;
  role: string;
  link: string;
  location: string;

  // AI-parsed. `country` is classified from the listing title and location, and is
  // kept when JD analysis is skipped. `jd` is parsed from the job description.
  country?: (typeof COUNTRIES)[number];
  jd?: JD | null;
}

/**
 * Why public stopped before a JD was stored. Absent on older rows.
 * `gone` is an explicit HTTP 404 or 410. `exhausted` used the shared attempt
 * budget on a temporary failure. `undetermined` is anything else, including
 * 403, a synthetic 404, and a parse failure.
 */
export interface OpportunityStop {
  reason: "gone" | "exhausted" | "undetermined";
  code: number;
  /** Producer signal. `closed` is a synthetic 404, not an HTTP 404. */
  failure?: "timeout" | "closed" | "invalid";
  at: string;
}

export interface Opportunity extends Job {
  postedAt: string;
  expired: boolean;
  stop?: OpportunityStop;
}
