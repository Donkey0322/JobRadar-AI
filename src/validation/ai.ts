import { z } from "zod";

import { SeasonSchema } from "./season";

export const AIResponseSchema = z.object({
  requires_usa_citizenship: z.enum(["yes", "no", "unsure"]),
  offers_visa_sponsorship: z.enum(["yes", "no", "unsure"]),
  qualifications: z.array(z.string()),
  term: SeasonSchema,
});

export type AIResponse = z.infer<typeof AIResponseSchema>;
