import { CONFIG } from "@/constants";

import { escapeRegExp } from "@/utils/url";
import { JobCategory } from "@/validation/config";

const ENGINEERING_WORDS = [
  "dev",
  "develop",
  "developer",
  "development",
  "eng.",
  "engr",
  "engr.",
  "engineer",
  "engineering",
  "swe",
  "sde",
  "fde",
  "programmer",
  "researcher",
  "scientist",
  "analyst",
];

const TECH_DOMAIN_WORDS = CONFIG.target.keywords ?? ["software", "swe", "fde"];

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
    const escaped = escapeRegExp(word).replace(/\s+/g, "\\s+").replace(/-/g, "[- ]?");

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
  if (isMid(t) || isSenior(t)) return false;

  return isEntry(t);
}

export function isTechMidLevel(title: string) {
  const t = normalize(title);

  if (!isTech(t)) return false;
  if (isNonTech(t)) return false;
  if (isIntern(t)) return false;

  return isMid(t);
}

export function isTechSeniorLevel(title: string) {
  const t = normalize(title);

  if (!isTech(t)) return false;
  if (isNonTech(t)) return false;
  if (isIntern(t)) return false;

  return isSenior(t);
}

/**
 * Owner-only: keep intern titles on the dashboard even if intern is not in
 * notify config. Country scope still comes from `target.countries`.
 * Mid/senior are only crawled when those categories are configured.
 * Template users omit this flag.
 */
export function includeAllTechJobs() {
  return CONFIG.dashboard?.includeAllTechJobs === true;
}

/**
 * Tech role with no intern / entry / mid / senior signal in the title.
 * These are queued for batch analysis instead of real-time notify.
 */
export function isUnspecifiedTechLevel(title: string) {
  const t = normalize(title);

  if (!isTech(t)) return false;
  if (isNonTech(t)) return false;
  if (isIntern(t) || isEntry(t) || isMid(t) || isSenior(t)) return false;

  return true;
}

/**
 * Titles that can produce email notify. Dashboard mode does not change this:
 * configured intern/full-time titles, plus unspecified-level tech titles
 * whose JD may later match config.
 */
export function isNotifyCandidate(title: string) {
  return isNotifyTarget(title) || isUnspecifiedTechLevel(title);
}

/**
 * Listing / discovery filter.
 * Always keep notify titles and unspecified-level tech titles.
 * Expanded dashboards also keep intern titles when intern is not in config.
 * Mid/senior stay off unless those categories are configured.
 */
export function isTarget(title: string, expanded = includeAllTechJobs()) {
  if (isNotifyCandidate(title)) return true;
  return expanded && isTechIntern(title);
}

/**
 * Real-time vs batch routing after discovery.
 * Notify titles stay on the real-time path.
 * Unspecified titles always batch.
 * Expanded dashboards also batch intern titles that are not in notify config.
 */
export function shouldBatchAnalyze(title: string, expanded = includeAllTechJobs()) {
  if (isNotifyTarget(title)) return false;
  if (isUnspecifiedTechLevel(title)) return true;
  return expanded && isTechIntern(title);
}

/**
 * Notification-priority heuristic from title + configured intern/full-time
 * categories. Only explicit level signals count; unspecified titles are not
 * treated as a match. Matching jobs use the original real-time analysis path.
 */
export function isNotifyTarget(title: string) {
  const status =
    (CONFIG.target?.intern?.includes(JobCategory.SUMMER_INTERN) && isTechIntern(title)) ||
    (CONFIG.target?.intern?.includes(JobCategory.OFF_SEASON_INTERN) && isTechIntern(title)) ||
    (CONFIG.target?.["full-time"]?.includes(JobCategory.ENTRY_LEVEL) && isTechEntryLevel(title)) ||
    (CONFIG.target?.["full-time"]?.includes(JobCategory.MID_LEVEL) && isTechMidLevel(title)) ||
    (CONFIG.target?.["full-time"]?.includes(JobCategory.SENIOR_LEVEL) && isTechSeniorLevel(title));

  if (status === undefined) {
    return true;
  }

  return status;
}

function getDiscoveryLookbackDays() {
  const days = Number(process.env.DISCOVERY_LOOKBACK_DAYS ?? 1);

  return Number.isInteger(days) && days >= 1 && days <= 7 ? days : 1;
}

export function withinDays(date: string | number | undefined | null, days = 1) {
  if (date === "" || date === null || date === undefined) return false;

  const value =
    typeof date === "number"
      ? date < 1e12
        ? date * 1000
        : date
      : /^\d+$/.test(date)
        ? Number(date) < 1e12
          ? Number(date) * 1000
          : Number(date)
        : date;

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) return false;

  const lookbackDays = Math.max(days, getDiscoveryLookbackDays());
  const daysAgo = new Date();
  daysAgo.setDate(daysAgo.getDate() - lookbackDays);

  return parsedDate >= daysAgo;
}
