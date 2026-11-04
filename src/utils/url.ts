/**
 * Remove the trailing slash from the URL.
 * @example
 * ```ts
 * removeTrailingSlash("https://example.com/"); // "https://example.com"
 * removeTrailingSlash("https://example.com//"); // "https://example.com"
 * ```
 */
export function removeTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * Return a URL's hostname without a leading `www.`.
 */
export function getHostnameWithoutWww(url: URL): string {
  return url.hostname.replace(/^www\./, "");
}

/**
 * Return the first hostname segment, excluding a leading `www.`.
 */
export function getSubdomainIdentifier(url: URL): string {
  return getHostnameWithoutWww(url).split(".")[0] || "unknown";
}

/**
 * Check whether a value is an absolute HTTP or HTTPS URL.
 */
export function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Escape the regular expression for the given value.
 * @example
 * ```ts
 *
 * const str = escapeRegExp("jobs.cisco.com"); // "jobs\.cisco\.com"
 * ```
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
