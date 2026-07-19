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
