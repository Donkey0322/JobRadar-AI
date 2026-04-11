import { z } from "zod";

export enum Target {
  SUMMER_INTERN = "summer intern",
  OFF_SEASON_INTERN = "off-season intern",
  NEW_GRAD = "new grad",
}

export const TargetSchema = z.enum(Object.values(Target));

export const ConfigSchema = z.object({
  target: z
    .array(TargetSchema)
    .min(
      1,
      "target has to be at least one of the following: summer intern, off-season intern, new grad"
    ),

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
