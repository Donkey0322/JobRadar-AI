import { CONFIG } from "@/constants";

import { JobCategory } from "@/validation/config";

const ENGINEERING_WORDS = [
  "dev",
  "develop",
  "developer",
  "development",
  "engineer",
  "engineering",
  "swe",
  "sde",
  "programmer",
];

const TECH_DOMAIN_WORDS = CONFIG.target.keywords ?? [
  "software",
  "backend",
  "back-end",
  "frontend",
  "front-end",
  "full-stack",
  "fullstack",
  "platform",
  "web",
  "mobile",
  "ios",
  "android",
  "data",
  "ai",
  "ml",
  "machine learning",
  "cloud",
  "infra",
  "infrastructure",
  "devops",
  "sre",
  "site reliability",
  "security",
  "automation",
  "ui",
  "ux",
];

// const STRONG_TECH_PHRASES = [
//   "software engineer",
//   "software engineering",
//   "software developer",
//   "backend engineer",
//   "back-end engineer",
//   "backend developer",
//   "back-end developer",
//   "frontend engineer",
//   "front-end engineer",
//   "frontend developer",
//   "front-end developer",
//   "full-stack engineer",
//   "full stack engineer",
//   "fullstack engineer",
//   "full-stack developer",
//   "full stack developer",
//   "fullstack developer",
//   "web engineer",
//   "web developer",
//   "mobile engineer",
//   "mobile developer",
//   "ios engineer",
//   "ios developer",
//   "android engineer",
//   "android developer",
//   "machine learning engineer",
//   "ml engineer",
//   "ai engineer",
//   "data engineer",
//   "platform engineer",
//   "cloud engineer",
//   "infrastructure engineer",
//   "devops engineer",
//   "site reliability engineer",
//   "security engineer",
//   "automation engineer",
//   "software development engineer",
// ];

const INTERN_WORDS = ["intern", "internship", "co-op", "coop", "student"];

const ENTRY_LEVEL_WORDS = [
  "junior",
  "entry",
  "early-career",
  "new grad",
  "new graduate",
  "graduate",
  "1",
  "i",
  "amts",
  "l1",
  "l2",
];

const MID_LEVEL_WORDS = ["2", "ii", "mid level", "mid-level"];

const SENIOR_LEVEL_WORDS = [
  "3",
  "iii",
  "senior",
  "sr.",
  "staff",
  "principal",
  "architect",
  "manager",
  "director",
  "distinguished",
  "lead",
  "head",
  "vp",
  "vice president",
];

const NON_TECH_WORDS = [
  "recruiter",
  "sales",
  "marketing",
  "customer success",
  "business analyst",
  "finance",
  "account executive",
  "operations",
  "program manager",
  "product marketing",
  "administrative",
  "support specialist",
  "partner manager",
];

function buildPatterns(words: string[]) {
  return words.map((word) => {
    const escaped = word
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+")
      .replace(/-/g, "[- ]?");

    return new RegExp(`(^|\\W)${escaped}($|\\W)`, "i");
  });
}

const ENGINEERING_PATTERNS = buildPatterns(ENGINEERING_WORDS);
const TECH_DOMAIN_PATTERNS = buildPatterns(TECH_DOMAIN_WORDS);
// const STRONG_TECH_PATTERNS = buildPatterns(STRONG_TECH_PHRASES);

const INTERN_PATTERNS = buildPatterns(INTERN_WORDS);
const ENTRY_LEVEL_PATTERNS = buildPatterns(ENTRY_LEVEL_WORDS);
const MID_LEVEL_PATTERNS = buildPatterns(MID_LEVEL_WORDS);
const SENIOR_LEVEL_PATTERNS = buildPatterns(SENIOR_LEVEL_WORDS);

const NON_TECH_PATTERNS = buildPatterns(NON_TECH_WORDS);

function hasPattern(patterns: RegExp[], text: string) {
  return patterns.some((regex) => regex.test(text));
}

function normalize(title: string) {
  return title.toLowerCase().trim();
}

function isEngineering(title: string) {
  return hasPattern(ENGINEERING_PATTERNS, title);
}

function isTechDomain(title: string) {
  return hasPattern(TECH_DOMAIN_PATTERNS, title);
}

// function isStrongTech(title: string) {
//   return hasPattern(STRONG_TECH_PATTERNS, title);
// }

function isTech(title: string) {
  return isEngineering(title) && isTechDomain(title);
}

function isNonTech(title: string) {
  return hasPattern(NON_TECH_PATTERNS, title);
}

function isIntern(title: string) {
  return hasPattern(INTERN_PATTERNS, title);
}

function isEntry(title: string) {
  return hasPattern(ENTRY_LEVEL_PATTERNS, title);
}

function isMid(title: string) {
  return hasPattern(MID_LEVEL_PATTERNS, title);
}

function isSenior(title: string) {
  return hasPattern(SENIOR_LEVEL_PATTERNS, title);
}

export function isTechIntern(title: string) {
  const t = normalize(title);

  if (!isTech(t)) return false;
  if (isNonTech(t)) return false;

  return isIntern(t);
}

export function isTechEntryLevel(title: string) {
  const t = normalize(title);

  if (!isTech(t)) return false;
  if (isNonTech(t)) return false;
  if (isIntern(t)) return false;

  const entry = isEntry(t);
  const mid = isMid(t);
  const senior = isSenior(t);

  // explicitly mid/senior
  if (mid || senior) return false;

  // explicitly entry
  if (entry) return true;

  // unspecified level => allow
  return true;
}

export function isTechMidLevel(title: string) {
  const t = normalize(title);

  if (!isTech(t)) return false;
  if (isNonTech(t)) return false;
  if (isIntern(t)) return false;

  const entry = isEntry(t);
  const mid = isMid(t);
  const senior = isSenior(t);

  if (mid) return true;

  if (entry || senior) return false;

  return true;
}

export function isTechSeniorLevel(title: string) {
  const t = normalize(title);

  if (!isTech(t)) return false;
  if (isNonTech(t)) return false;
  if (isIntern(t)) return false;

  const entry = isEntry(t);
  const mid = isMid(t);
  const senior = isSenior(t);

  if (senior) return true;

  if (entry || mid) return false;

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

export function withinDays(date: string | number, days = 1) {
  const daysAgo = new Date();
  daysAgo.setDate(daysAgo.getDate() - days);
  return new Date(date) >= daysAgo;
}
