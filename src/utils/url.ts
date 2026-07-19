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
