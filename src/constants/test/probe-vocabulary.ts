import { COUNTRIES } from "@/constants/country";
import { JOB_CATEGORIES, JobCategory } from "@/constants/job-category";
import { getSeasonYears,SEASON_VALUES, SEASONS } from "@/constants/season";

if (COUNTRIES[0] !== "USA" || COUNTRIES.at(-1) !== "Other") {
  throw new Error("country order changed");
}

if (
  JOB_CATEGORIES.join("\n") !==
  [
    JobCategory.SUMMER_INTERN,
    JobCategory.OFF_SEASON_INTERN,
    JobCategory.ENTRY_LEVEL,
    JobCategory.MID_LEVEL,
    JobCategory.SENIOR_LEVEL,
  ].join("\n")
) {
  throw new Error("category order changed");
}

if (SEASON_VALUES.at(-1) !== SEASONS.none || SEASONS.none !== "None") {
  throw new Error("season values changed");
}

if (!Number.isFinite(getSeasonYears().summer)) {
  throw new Error("season year missing");
}

console.log("vocabulary-ok");
