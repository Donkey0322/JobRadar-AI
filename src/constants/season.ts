// year should be dynamically change
const NOW = new Date(
  new Date().toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
  })
);

const year = NOW.getFullYear();
const month = NOW.getMonth() + 1;

function getSeasonYears() {
  if (month >= 9) {
    return {
      summer: year + 1,
      fall: year + 1,
      spring: year + 1,
      winter: year + 1,
    };
  }

  if (month >= 6) {
    return {
      summer: year + 1,
      fall: year,
      spring: year + 1,
      winter: year + 1,
    };
  }

  return {
    summer: year,
    fall: year,
    spring: year + 1,
    winter: year + 1,
  };
}

const seasons = getSeasonYears();

const SEASONS = {
  summer: `${seasons.summer} Summer`,
  fall: `${seasons.fall} Fall`,
  spring: `${seasons.spring} Spring`,
  winter: `${seasons.winter} Winter`,
  none: "None",
} as const;

export const SEASON_VALUES = [
  SEASONS.summer,
  SEASONS.fall,
  SEASONS.spring,
  SEASONS.winter,
  SEASONS.none,
] as const;

export default SEASONS;
