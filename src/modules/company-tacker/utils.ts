import { CONFIG } from "@/constants";

import { JobCategory } from "@/validation/config";

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

function hasPattern(patterns: RegExp[], text: string) {
  return patterns.some((regex) => regex.test(text));
}

function isTech(title: string) {
  return hasPattern(TECH_PATTERNS, title);
}

function isIntern(title: string) {
  return hasPattern(INTERN_PATTERNS, title);
}

export function isTechIntern(title: string) {
  const t = title.toLowerCase();

  return isTech(t) && isIntern(t);
}

export function isTechEntryLevel(title: string) {
  const t = title.toLowerCase();

  if (!isTech(t) || isIntern(t)) return false;

  const isEntry = hasPattern(ENTRY_LEVEL_PATTERNS, t);
  const isMid = hasPattern(MID_LEVEL_PATTERNS, t);
  const isSenior = hasPattern(SENIOR_LEVEL_PATTERNS, t);

  // explicitly entry level
  if (isEntry) return true;

  // explicitly another level
  if (isMid || isSenior) return false;

  // no level specified
  return true;
}

export function isTechMidLevel(title: string) {
  const t = title.toLowerCase();

  if (!isTech(t) || isIntern(t)) return false;

  const isEntry = hasPattern(ENTRY_LEVEL_PATTERNS, t);
  const isMid = hasPattern(MID_LEVEL_PATTERNS, t);
  const isSenior = hasPattern(SENIOR_LEVEL_PATTERNS, t);

  // explicitly mid level
  if (isMid) return true;

  // explicitly another level
  if (isEntry || isSenior) return false;

  // no level specified
  return true;
}

export function isTechSeniorLevel(title: string) {
  const t = title.toLowerCase();

  if (!isTech(t) || isIntern(t)) return false;

  const isEntry = hasPattern(ENTRY_LEVEL_PATTERNS, t);
  const isMid = hasPattern(MID_LEVEL_PATTERNS, t);
  const isSenior = hasPattern(SENIOR_LEVEL_PATTERNS, t);

  // explicitly senior level
  if (isSenior) return true;

  // explicitly another level
  if (isEntry || isMid) return false;

  // no level specified
  return true;
}

export function isTarget(title: string) {
  return (
    (CONFIG.target?.intern?.includes(JobCategory.SUMMER_INTERN) && isTechIntern(title)) ||
    (CONFIG.target?.intern?.includes(JobCategory.OFF_SEASON_INTERN) && isTechIntern(title)) ||
    (CONFIG.target?.["full-time"]?.includes(JobCategory.ENTRY_LEVEL) && isTechEntryLevel(title)) ||
    (CONFIG.target?.["full-time"]?.includes(JobCategory.MID_LEVEL) && isTechMidLevel(title)) ||
    (CONFIG.target?.["full-time"]?.includes(JobCategory.SENIOR_LEVEL) && isTechSeniorLevel(title))
  );
}

export function withinDays(date: string | number) {
  const daysAgo = new Date();
  daysAgo.setDate(daysAgo.getDate() - 1);

  return new Date(date) >= daysAgo;
}
