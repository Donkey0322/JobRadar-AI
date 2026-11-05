/**
 * Optional limit for a liveness listing. Discovery `fetch()` does not use this.
 * An empty target set does not stop paging.
 */
export interface ListingScan {
  targetKeys?: ReadonlySet<string>;
  onPage?: () => void;
}

/** True only when every requested key has already been seen. */
export function listingTargetsFound(
  found: ReadonlySet<string>,
  scan: ListingScan | undefined
): boolean {
  const targets = scan?.targetKeys;
  if (!targets || targets.size === 0) return false;

  for (const key of targets) {
    if (!found.has(key)) return false;
  }

  return true;
}
