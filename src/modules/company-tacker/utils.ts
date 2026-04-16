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
const NEW_GRAD_WORDS = [
  "junior",
  "software engineer 1",
  "software engineer i",
  "entry",
  "early",
  "new grad",
  "new graduate",
];

function buildPatterns(words: string[]) {
  return words.map((word) => {
    const pattern = word.replace(/\s+/g, "\\s+").replace(/-/g, "[- ]?");
    return new RegExp(`\\b${pattern}\\b`, "i");
  });
}
const INTERN_PATTERNS = buildPatterns(INTERN_WORDS);
const NEW_GRAD_PATTERNS = buildPatterns(NEW_GRAD_WORDS);
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
  const isNewGrad = NEW_GRAD_PATTERNS.some((regex) => regex.test(t));
  return isTech && isNewGrad;
}

export function isTarget(title: string) {
  return (
    (CONFIG.target.includes(Target.SUMMER_INTERN) && isTechIntern(title)) ||
    (CONFIG.target.includes(Target.OFF_SEASON_INTERN) && isTechIntern(title)) ||
    (CONFIG.target.includes(Target.NEW_GRAD) && isTechNewGrad(title))
  );
}

export function withinDays(date: string | number) {
  const daysAgo = new Date();
  daysAgo.setDate(daysAgo.getDate() - 1);
  return new Date(date) >= daysAgo;
}
