import type { Company } from "@/types";

import { classifyATS } from "./classifier";
import { employers } from "./registry";

import { formatCompanyName } from "@/utils/string";
import { getHostnameWithoutWww } from "@/utils/url";

function tenantHintFromUrl(url: URL): string | undefined {
  if (url.hostname.endsWith("myworkdaysite.com")) {
    const parts = url.pathname.split("/").filter(Boolean);
    const recruitingIndex = parts.findIndex((part) => part.toLowerCase() === "recruiting");
    return parts[recruitingIndex + 1];
  }

  return url.hostname.split(".")[0];
}

/**
 * Display name for a link that already belongs to a stored employer.
 * Returns null when the URL does not match one.
 */
export function knownEmployerName(
  link: string,
  companiesByKey: ReadonlyMap<string, Company>
): string | null {
  try {
    const url = new URL(link);
    const company = companiesByKey.get(employers[classifyATS(url)].companyKeyFromUrl(url));
    return company ? formatCompanyName(company.name) : null;
  } catch {
    return null;
  }
}

/**
 * Rewrite a stored company label after an identifier remap.
 * Only rows whose company still matches the URL tenant, slug, identifier, or
 * hostname change (e.g. globalhr → Rtx).
 */
export function remapStoredCompany<T extends { company: string; link: string }>(
  record: T,
  companiesByKey: ReadonlyMap<string, Company>
): T {
  try {
    const url = new URL(record.link);
    const company = companiesByKey.get(employers[classifyATS(url)].companyKeyFromUrl(url));

    if (!company) {
      return record;
    }

    const displayName = formatCompanyName(company.name);

    if (record.company === displayName) {
      return record;
    }

    const tenant = tenantHintFromUrl(url);
    const storedLower = record.company.toLowerCase();
    const isUrlTenant = Boolean(tenant && storedLower === tenant.toLowerCase());
    const isCanonicalSlug = storedLower === company.name.toLowerCase();
    const isIdentifier = Boolean(
      company.identifier && storedLower === company.identifier.toLowerCase()
    );
    const isHostname = storedLower === getHostnameWithoutWww(url).toLowerCase();

    if (!isUrlTenant && !isCanonicalSlug && !isIdentifier && !isHostname) {
      return record;
    }

    return {
      ...record,
      company: displayName,
    };
  } catch {
    return record;
  }
}
