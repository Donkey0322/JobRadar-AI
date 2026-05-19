import type { LOCATIONS } from "@/constants/location";
import type { Season } from "@/validation/season";

export interface JD {
  citizenship: boolean | null;
  sponsorship: boolean | null;
  qualifications: string[] | null;
  location: (typeof LOCATIONS)[number];
  season?: Season;
}

export interface Job {
  id?: number;
  company: string;
  role: string;
  link: string;
  location: string;
  season?: Season;
  jd?: JD | null;
}
