import { z } from "zod";

import { COUNTRIES } from "@/constants/country";
import { JOB_CATEGORIES } from "@/constants/job-category";
import { SEASONS } from "@/constants/season";

export const SeasonSchema = z.enum(SEASONS);
export type Season = z.infer<typeof SeasonSchema>;

export const JDResponseSchema = z.object({
  citizenship: z.boolean().nullable(),
  sponsorship: z.boolean().nullable(),
  country: z.enum(COUNTRIES),
  location: z.string().nullable(),
  qualifications: z.array(z.string()).nullish(),
  category: z.enum(JOB_CATEGORIES),
  season: SeasonSchema,
});

export type JDResponse = z.infer<typeof JDResponseSchema>;
