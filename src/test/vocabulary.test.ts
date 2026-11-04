import { describe, expect, it } from "vitest";

import { COUNTRIES } from "@/constants/country";
import { JobCategory } from "@/constants/job-category";
import { SEASON_VALUES } from "@/constants/season";

import type { Country as VocabularyCountry } from "@/constants/country";
import type { Season as VocabularySeason } from "@/constants/season";

import { ConfigSchema, type Country as SchemaCountry } from "@/validation/config";
import { type Season as SchemaSeason, SeasonSchema } from "@/validation/season";
import { createValidConfig } from "@/validation/test/config.test-utils";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type Assert<T extends true> = T;

type _country = Assert<Equal<SchemaCountry, VocabularyCountry>>;
type _season = Assert<Equal<SchemaSeason, VocabularySeason>>;

const countryMatches: _country = true;
const seasonMatches: _season = true;

describe("vocabulary and config schema", () => {
  it("accepts the category vocabulary in the same groups", () => {
    const parsed = ConfigSchema.safeParse(
      createValidConfig({
        target: {
          intern: [JobCategory.SUMMER_INTERN, JobCategory.OFF_SEASON_INTERN],
          "full-time": [JobCategory.ENTRY_LEVEL, JobCategory.MID_LEVEL, JobCategory.SENIOR_LEVEL],
          countries: ["USA"],
        },
      })
    );

    expect(parsed.success).toBe(true);
  });

  it("rejects a full-time category in the intern list", () => {
    const config = createValidConfig();
    config.target.intern = [JobCategory.ENTRY_LEVEL as "summer intern"];

    expect(ConfigSchema.safeParse(config).success).toBe(false);
  });

  it("accepts every country and season value", () => {
    const parsed = ConfigSchema.safeParse(
      createValidConfig({
        target: {
          countries: [...COUNTRIES],
        },
      })
    );

    expect(parsed.success).toBe(true);
    expect(countryMatches).toBe(true);
    expect(seasonMatches).toBe(true);
    for (const season of SEASON_VALUES) {
      expect(SeasonSchema.safeParse(season).success).toBe(true);
    }
    expect(SeasonSchema.safeParse("spring").success).toBe(false);
  });
});
