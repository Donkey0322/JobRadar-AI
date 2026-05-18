import { z } from "zod";

export enum Target {
  SUMMER_INTERN = "summer intern",
  OFF_SEASON_INTERN = "off-season intern",
  ENTRY_LEVEL = "entry level",
  MID_LEVEL = "mid level",
  SENIOR_LEVEL = "senior level",
}

export const TargetSchema = z.object({
  intern: z
    .array(z.enum([Target.SUMMER_INTERN, Target.OFF_SEASON_INTERN]))
    .min(1, "intern has to be at least one of the following: summer intern, off-season intern")
    .optional(),
  "full-time": z
    .array(z.enum([Target.ENTRY_LEVEL, Target.MID_LEVEL, Target.SENIOR_LEVEL]))
    .min(
      1,
      "full-time has to be at least one of the following: entry level, mid level, senior level"
    )
    .optional(),
});

export const ConfigSchema = z.object({
  target: TargetSchema,

  sender: z.object({
    host: z.string().min(1, "host cannot be empty"),
    port: z.number().int().min(1).max(65535, "port must be between 1 and 65535"),
    user: z.string().min(1),
    email: z.string().email(),
  }),

  receiver: z.object({
    email: z.string().email(),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;
