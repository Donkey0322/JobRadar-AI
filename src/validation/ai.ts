import { z } from "zod";

import { SEASONS } from "@/constants";
import { LOCATIONS } from "@/constants/location";

export const JDResponseSchema = z.object({
  citizenship_required: z.boolean().nullable(),
  visa_sponsorship_available: z.boolean().nullable(),
  location: z.enum(LOCATIONS),
  qualifications: z.array(z.string()),
  term: z.enum(SEASONS),
});

export type JDResponse = z.infer<typeof JDResponseSchema>;
