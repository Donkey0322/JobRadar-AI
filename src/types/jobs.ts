import type { COUNTRIES } from "@/constants";
import type { JobCategory } from "@/validation/config";
import type { Season } from "@/validation/season";

export interface JD {
  citizenship: boolean | null;
  sponsorship: boolean | null;
  qualifications: string[] | null;

  // these fields are added to fill the gap between Job and JD
  country: (typeof COUNTRIES)[number];
  category: JobCategory;
  // if category is entry level, mid level, or senior level, season is none
  // if season is not found, return none
  season: Season;
}

export interface Job {
  id?: number;
  company: string;
  role: string;
  link: string;
  jd?: JD | null;
  location: string;
}

export interface Opportunity extends Job {
  postedAt: string;
}
