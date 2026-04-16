import { z } from "zod";

import { SEASONS } from "@/constants";

export const SeasonSchema = z.enum(SEASONS);

export type Season = z.infer<typeof SeasonSchema>;
