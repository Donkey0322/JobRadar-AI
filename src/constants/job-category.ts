export enum JobCategory {
  SUMMER_INTERN = "summer intern",
  OFF_SEASON_INTERN = "off-season intern",

  ENTRY_LEVEL = "entry level",
  MID_LEVEL = "mid level",
  SENIOR_LEVEL = "senior level",
}

export const JOB_CATEGORIES = [
  JobCategory.SUMMER_INTERN,
  JobCategory.OFF_SEASON_INTERN,
  JobCategory.ENTRY_LEVEL,
  JobCategory.MID_LEVEL,
  JobCategory.SENIOR_LEVEL,
] as const;
