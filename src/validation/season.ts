import { z } from "zod";

import { SEASONS } from "@/constants/season";

export const SeasonSchema = z.enum(SEASONS);

export type Season = z.infer<typeof SeasonSchema>;
