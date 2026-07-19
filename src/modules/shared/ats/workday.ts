export type WorkdayLocaleMode = "lenient" | "strict";

export function isWorkdayLocaleSegment(segment: string, mode: WorkdayLocaleMode): boolean {
  return mode === "lenient"
    ? /^[a-z]{2}-[a-z]{2}$/i.test(segment)
    : /^[a-z]{2}-[A-Z]{2}$/.test(segment);
}
