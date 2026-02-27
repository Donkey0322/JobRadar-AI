import type { Season } from "@/validation/season";

export interface JD {
  citizenship: boolean | null;
  sponsorship: boolean | null;
  qualifications: string[] | null;
  season?: Season;
}

export interface Job {
  company: string;
  role: string;
  link: string;
  location: string;
  season?: Season;
  jd?: JD | null;
}
