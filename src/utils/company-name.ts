function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

/** Capitalize a lowercase slug. Leave a name that already has capitals unchanged. */
const LEGAL_SUFFIX = /,?\s+(?:Inc|LLC|L\.L\.C|Ltd|Corp|Corporation)\.?$/i;

/** `GitHub, Inc.` → `GitHub`. Only a trailing suffix is removed. */
export function stripLegalSuffix(name: string): string {
  const trimmed = name.trim();
  return trimmed.replace(LEGAL_SUFFIX, "").trim() || trimmed;
}

export function formatCompanyName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === trimmed.toLowerCase()) return capitalize(trimmed);
  return trimmed;
}
