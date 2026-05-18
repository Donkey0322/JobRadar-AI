import { CONFIG } from "@/constants";

import { Target } from "@/validation/config";

const TECH_WORDS = [
  "software",
  "system",
  "develop",
  "backend",
  "back-end",
  "frontend",
  "front-end",
  "full stack",
  "fullstack",
  "platform",
  "web",
  "mobile",
  "data",
  "ai",
  "cloud",
  "swe",
  "devops",
];
const INTERN_WORDS = ["intern", "internship", "co-op", "coop", "student"];
const ENTRY_LEVEL_WORDS = [
  "junior",
  "software engineer 1",
  "software engineer i",
  "entry",
  "early",
  "new grad",
  "new graduate",
];
const MID_LEVEL_WORDS = [
  "software engineer 2",
  "software engineer ii",
  "mid level",
  "mid-level",
  "mid",
];
const SENIOR_LEVEL_WORDS = [
  "software engineer 3",
  "software engineer iii",
  "senior level",
  "senior-level",
  "senior",
];

function buildPatterns(words: string[]) {
  return words.map((word) => {
    const pattern = word.replace(/\s+/g, "\\s+").replace(/-/g, "[- ]?");
    return new RegExp(`\\b${pattern}\\b`, "i");
  });
}
const INTERN_PATTERNS = buildPatterns(INTERN_WORDS);
const ENTRY_LEVEL_PATTERNS = buildPatterns(ENTRY_LEVEL_WORDS);
const MID_LEVEL_PATTERNS = buildPatterns(MID_LEVEL_WORDS);
const SENIOR_LEVEL_PATTERNS = buildPatterns(SENIOR_LEVEL_WORDS);
const TECH_PATTERNS = buildPatterns(TECH_WORDS);

function isTechIntern(title: string) {
  const t = title.toLowerCase();
  const isIntern = INTERN_PATTERNS.some((regex) => regex.test(t));
  const isTech = TECH_PATTERNS.some((regex) => regex.test(t));
  return isIntern && isTech;
}

function isTechNewGrad(title: string) {
  const t = title.toLowerCase();
  const isTech = TECH_PATTERNS.some((regex) => regex.test(t));
  const isNewGrad = ENTRY_LEVEL_PATTERNS.some((regex) => regex.test(t));
  return isTech && isNewGrad;
}
function isTechMidLevel(title: string) {
  const t = title.toLowerCase();
  const isTech = TECH_PATTERNS.some((regex) => regex.test(t));
  const isMidLevel = MID_LEVEL_PATTERNS.some((regex) => regex.test(t));
  return isTech && isMidLevel;
}
function isTechSeniorLevel(title: string) {
  const t = title.toLowerCase();
  const isTech = TECH_PATTERNS.some((regex) => regex.test(t));
  const isSeniorLevel = SENIOR_LEVEL_PATTERNS.some((regex) => regex.test(t));
  return isTech && isSeniorLevel;
}

export function isTarget(title: string) {
  return (
    (CONFIG.target?.intern?.includes(Target.SUMMER_INTERN) && isTechIntern(title)) ||
    (CONFIG.target?.intern?.includes(Target.OFF_SEASON_INTERN) && isTechIntern(title)) ||
    (CONFIG.target?.["full-time"]?.includes(Target.ENTRY_LEVEL) && isTechNewGrad(title)) ||
    (CONFIG.target?.["full-time"]?.includes(Target.MID_LEVEL) && isTechMidLevel(title)) ||
    (CONFIG.target?.["full-time"]?.includes(Target.SENIOR_LEVEL) && isTechSeniorLevel(title))
  );
}

export function withinDays(date: string | number) {
  const daysAgo = new Date();
  daysAgo.setDate(daysAgo.getDate() - 1);
  return new Date(date) >= daysAgo;
}
