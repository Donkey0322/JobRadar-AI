export function getToday(): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "2-digit",
  }).format(new Date());
}

export const HREF_RE = /href="([^"]+)"/;

export const SYMBOLS_TO_EXCLUDE = ["🛂", "🇺🇸", "🔒"];

export function containsExcludedSymbols(text: string): boolean {
  return SYMBOLS_TO_EXCLUDE.some((sym) => text.includes(sym));
}

/**
 * remove the query inside the link that starts with utm_* or ref, and remove the fragment (including "#/")
 * only process the query, do not modify the path, to avoid breaking the %2F etc. path encoding
 */
export function cleanLink(link: string): string {
  try {
    const url = new URL(link);

    // only process the query
    const params = new URLSearchParams(url.search);
    const filtered = new URLSearchParams();

    for (const [keyRaw, value] of params.entries()) {
      const key = (keyRaw || "").replace(/^;+/, "").toLowerCase();

      // filter out utm_* and ref
      if (key.startsWith("utm_")) continue;
      if (key === "ref") continue;

      filtered.append(keyRaw, value);
    }

    // set the new query
    url.search = filtered.toString();

    // remove the fragment (including "#/")
    url.hash = "";

    let cleaned = url.toString();
    // if the query is empty, avoid leaving '?'
    if (cleaned.endsWith("?")) {
      cleaned = cleaned.slice(0, -1);
    }

    return cleaned;
  } catch {
    return link;
  }
}

export function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

const VALID_SEASONS = new Set(["Winter", "Spring", "Summer", "Fall"]);
export function normalizeSeason(input: string): string {
  const cleaned = input.trim();

  if (cleaned.toLowerCase() === "unsure") {
    return "unsure";
  }

  if (cleaned.toLowerCase() === "entry level") {
    return "Entry Level";
  }

  const parts = cleaned.split(/\s+/);
  if (parts.length !== 2) return input;

  let [a, b] = parts;

  a = capitalize(a);
  b = capitalize(b);

  if (/^\d{4}$/.test(a) && VALID_SEASONS.has(b)) {
    return `${a} ${b}`;
  }

  if (VALID_SEASONS.has(a) && /^\d{4}$/.test(b)) {
    return `${b} ${a}`;
  }

  return input;
}

export function safeFilename(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

export function stringifyResult(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}
