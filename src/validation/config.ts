import { z } from "zod";

// do not use import from "@/constants" to avoid circular dependency
import { COUNTRIES } from "@/constants/country";

export enum JobCategory {
  SUMMER_INTERN = "summer intern",
  OFF_SEASON_INTERN = "off-season intern",

  ENTRY_LEVEL = "entry level",
  MID_LEVEL = "mid level",
  SENIOR_LEVEL = "senior level",
}

const CountrySchema = z.enum(COUNTRIES);
export type Country = z.infer<typeof CountrySchema>;

const CountryFilterSchema = z.object({
  allow_citizenship_required: z.boolean().optional(),
  allow_no_sponsorship: z.boolean().optional(),
});

export const TargetSchema = z
  .object({
    intern: z
      .array(z.enum([JobCategory.SUMMER_INTERN, JobCategory.OFF_SEASON_INTERN]))
      .min(1, "intern has to be at least one of the following: summer intern, off-season intern")
      .optional(),

    "full-time": z
      .array(z.enum([JobCategory.ENTRY_LEVEL, JobCategory.MID_LEVEL, JobCategory.SENIOR_LEVEL]))
      .min(
        1,
        "full-time has to be at least one of the following: entry level, mid level, senior level"
      )
      .optional(),

    countries: z.array(CountrySchema),

    filter: z.partialRecord(CountrySchema, CountryFilterSchema).optional(),

    keywords: z.array(z.string()).optional(),

    /**
     * Title words that outrank excludeKeywords. A matching title is kept even
     * when an exclude word is also present. Matching is case-insensitive and whole-word.
     */
    priorityKeywords: z.array(z.string()).optional(),

    /**
     * Title words that reject a role unless a priority keyword is also present.
     * Matching is case-insensitive and whole-word.
     */
    excludeKeywords: z.array(z.string()).optional(),
  })
  .superRefine((target, ctx) => {
    if (!target.filter) {
      return;
    }

    const allowedCountries = new Set(target.countries);

    for (const key of Object.keys(target.filter)) {
      if (!allowedCountries.has(key as (typeof COUNTRIES)[number])) {
        ctx.addIssue({
          code: "custom",
          path: ["filter", key],
          message: `"${key}" filter requires "${key}" to exist in target.countries`,
        });
      }
    }
  });

const AISchema = z.discriminatedUnion("enabled", [
  z.object({
    enabled: z.literal(false),
  }),
  z.object({
    enabled: z.literal(true),
    provider: z.enum(["openai", "google", "anthropic"]),
    model: z.string().min(1),
  }),
]);

export const ConfigSchema = z.object({
  target: TargetSchema,

  /**
   * Owner-only. Omitted from the setup issue form, so template installs stay
   * hybrid: notify titles are analyzed in real time, unspecified titles batch.
   * When batchOnly is true, every discovered target is queued for batch.
   */
  dashboard: z
    .object({
      batchOnly: z.boolean().optional(),
    })
    .optional(),

  ai: AISchema,

  sender: z.object({
    host: z.string().min(1, "host cannot be empty"),
    port: z.number().int().min(1).max(65535),
    user: z.string().min(1),
    email: z.email(),
  }),

  receiver: z.object({
    emails: z.array(z.email()).min(1, "at least one receiver email is required"),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;
