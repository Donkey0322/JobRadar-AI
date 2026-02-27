import { z } from "zod";

export const SeasonSchema = z.enum([
  "2026 Summer",
  "2026 Fall",
  "2027 Spring",
  "2027 Winter",
  "New Grad",
  "unsure",
]);

export type Season = z.infer<typeof SeasonSchema>;
