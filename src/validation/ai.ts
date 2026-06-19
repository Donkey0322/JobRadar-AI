import { z } from "zod";

import { JOB_CATEGORIES, SEASONS } from "@/constants";
import { COUNTRIES } from "@/constants/country";

export const JDResponseSchema = z.object({
  citizenship: z.boolean().nullable(),
  sponsorship: z.boolean().nullable(),
  country: z.enum(COUNTRIES),
  location: z.string().nullable(),
  qualifications: z.array(z.string()),
  category: z.enum(JOB_CATEGORIES),
  season: z.enum(SEASONS),
});

export type JDResponse = z.infer<typeof JDResponseSchema>;
