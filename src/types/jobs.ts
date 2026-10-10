import type { COUNTRIES } from "@/constants";
import type { JobCategory } from "@/validation/config";
import type { Season } from "@/validation/season";

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

export interface Opportunity extends Job {
  postedAt: string;
  expired: boolean;
}
