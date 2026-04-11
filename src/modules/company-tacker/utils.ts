import { CONFIG } from "@/constants";
import { Target } from "@/validation/config";

const TECH_WORDS = [
  "software",
  "engineer",
  "developer",
  "backend",
  "frontend",
  "full stack",
  "platform",
  "web",
  "mobile",
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

function isTechIntern(title: string) {
  const t = title.toLowerCase();
  const isIntern = INTERN_WORDS.some((word) => {
    const pattern = word.replace("-", "[- ]?");
    const regex = new RegExp(`\\b${pattern}\\b`, "i");
    return regex.test(t);
  });
  const isTech = TECH_WORDS.some((word) => t.includes(word));
  return isIntern && isTech;
}

function isTechNewGrad(title: string) {
  const t = title.toLowerCase();
  const isTech = TECH_WORDS.some((word) => t.includes(word));
  const NEW_GRAD_PATTERNS = NEW_GRAD_WORDS.map((word) => {
    const pattern = word.replace(/\s+/g, "\\s+").replace("-", "[- ]?");
    return new RegExp(`\\b${pattern}\\b`, "i");
  });
  const isNewGrad = NEW_GRAD_PATTERNS.some((r) => r.test(t));
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
