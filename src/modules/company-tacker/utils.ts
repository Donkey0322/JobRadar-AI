export function isTechIntern(title: string) {
  const t = title.toLowerCase();

  const isIntern =
    t.includes("intern") ||
    t.includes("internship") ||
    t.includes("co-op") ||
    t.includes("coop") ||
    t.includes("student");

  const isTech =
    t.includes("software") ||
    t.includes("engineer") ||
    t.includes("developer") ||
    t.includes("backend") ||
    t.includes("frontend") ||
    t.includes("full stack") ||
    t.includes("platform") ||
    t.includes("web") ||
    t.includes("mobile");

  return isIntern && isTech;
}

export function withinDays(date: string | number) {
  const daysAgo = new Date();
  daysAgo.setDate(daysAgo.getDate() - 1);
  return new Date(date) >= daysAgo;
}
