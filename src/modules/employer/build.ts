import pLimit from "p-limit";
import { URL } from "url";

import type { Company } from "@/types";

import { aliasedCompanyKey } from "./aliases";
import { classifyATS } from "./classifier";
import { identityKey } from "./employer";
import { employers } from "./registry";

import { loadCompanies, saveCompanies } from "@/utils/data";
import { renderProgress, startProgress } from "@/utils/dev";
import { logger } from "@/utils/logger";

const CONCURRENCY = 10;

export function getCompanyKey(company: Company): string {
  return identityKey(company);
}

/**
 * Bare domain/page URLs often omit the company slug (e.g. https://jobs.lever.co),
 * which would form a company with an undefined name, so re-key from a job URL.
 * The exception is a url-less custom or none row whose domain now classifies
 * differently, e.g. a tenant board (https://mujin.bamboohr.com) of an ATS added
 * after the row was built.
 */
function representativeUrl(existing: Company): URL | null {
  try {
    if (existing.urls[0]) return new URL(existing.urls[0]);
    if ((existing.ats !== "custom" && existing.ats !== "none") || !existing.domain) return null;

    const domain = new URL(existing.domain);
    return classifyATS(domain) === existing.ats ? null : domain;
  } catch {
    return null;
  }
}

async function resolveExistingCompany(stored: Company): Promise<{ key: string; company: Company }> {
  const existing = employers[stored.ats]?.repairCompany(stored) ?? stored;
  const existingKey = getCompanyKey(existing);
  const url = representativeUrl(existing);

  if (!url) {
    return { key: existingKey, company: existing };
  }

  try {
    const fetcher = employers[classifyATS(url)];
    const resolvedKey = careerSiteAlias(url.href) ?? fetcher.companyKeyFromUrl(url);

    if (resolvedKey === existingKey) {
      return { key: existingKey, company: existing };
    }

    const reformed = await fetcher.formCompany(url);

    if (!reformed?.name) {
      return { key: existingKey, company: existing };
    }

    return { key: getCompanyKey(reformed), company: reformed };
  } catch {
    return { key: existingKey, company: existing };
  }
}

/** Company key of the ATS row an unread career-site URL belongs to, if it is aliased. */
function careerSiteAlias(urlStr: string): string | null {
  try {
    const url = new URL(urlStr);
    return classifyATS(url) === "none" ? aliasedCompanyKey(url) : null;
  } catch {
    return null;
  }
}

function isAliasedSiteRow(company: Company): boolean {
  return company.ats === "none" && Boolean(company.domain && careerSiteAlias(company.domain));
}

export function groupUrlsByCompanyKey(urls: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();

  for (const urlStr of urls) {
    let key: string;

    try {
      const url = new URL(urlStr);
      const ats = classifyATS(url);
      key = careerSiteAlias(urlStr) ?? employers[ats].companyKeyFromUrl(url);
    } catch (err) {
      logger.warn({ url: urlStr, err }, "Failed to derive company key from URL");
      key = `unkeyed:${urlStr}`;
    }

    const group = groups.get(key);

    if (group) {
      group.push(urlStr);
    } else {
      groups.set(key, [urlStr]);
    }
  }

  return groups;
}

async function formCompanyFromGroup(
  groupKey: string,
  groupUrls: string[]
): Promise<{ groupKey: string; company: Company | null }> {
  const representative = groupUrls[0];

  try {
    const url = new URL(representative);
    const ats = classifyATS(url);
    const company = await employers[ats].formCompany(url);

    if (!company) {
      return { groupKey, company: null };
    }

    return {
      groupKey,
      company: {
        ...company,
        urls: [...groupUrls],
      },
    };
  } catch (err) {
    logger.warn(
      {
        url: representative,
        urls: groupUrls.length,
        err,
      },
      "Failed to extract company from URL"
    );

    return { groupKey, company: null };
  }
}

export async function buildCompanyList(urls: string[] | Set<string>): Promise<Company[]> {
  const map = new Map<string, Company>();

  const groups = groupUrlsByCompanyKey(Array.from(urls));
  const aliasedGroups = new Map<string, string[]>();

  for (const [groupKey, groupUrls] of groups) {
    const boardUrls = groupUrls.filter((url) => !careerSiteAlias(url));

    if (boardUrls.length === 0) {
      aliasedGroups.set(groupKey, groupUrls);
      groups.delete(groupKey);
    } else {
      // formCompanyFromGroup forms from the first URL, which must be the board's own.
      groups.set(groupKey, [...boardUrls, ...groupUrls.filter((url) => careerSiteAlias(url))]);
    }
  }

  const total = groups.size;
  let completed = 0;

  const limit = pLimit(CONCURRENCY);

  startProgress(total);

  const results = await Promise.all(
    Array.from(groups.entries()).map(([groupKey, groupUrls]) =>
      limit(async () => {
        const result = await formCompanyFromGroup(groupKey, groupUrls);

        completed++;
        renderProgress(completed, total);

        return result;
      })
    )
  );

  for (const { company } of results) {
    if (!company?.name) {
      continue;
    }

    const key = getCompanyKey(company);

    if (!map.has(key)) {
      map.set(key, company);
      continue;
    }

    map.get(key)!.urls.push(...company.urls);
  }

  // Merge existing companies so companies don't disappear.
  // Re-resolve keys so identifier remaps replace stale rows instead of duplicating them.
  const existingCompanies = await loadCompanies();
  const resolvedExisting = await Promise.all(existingCompanies.map(resolveExistingCompany));

  for (const { key, company } of resolvedExisting) {
    if (!company.name || isAliasedSiteRow(company)) {
      continue;
    }

    // A stored name may be hand-edited, and a fetched one falls back to a slug when the lookup fails.
    const formed = map.get(key);
    if (formed) {
      formed.name = company.name;
      continue;
    }

    map.set(key, {
      ...company,
      urls: [],
    });
  }

  for (const [groupKey, groupUrls] of aliasedGroups) {
    const target = map.get(groupKey);

    if (target) {
      target.urls.push(...groupUrls);
      continue;
    }

    const { company } = await formCompanyFromGroup(groupKey, groupUrls);
    if (company?.name) map.set(getCompanyKey(company), company);
  }

  const result = Array.from(map.values())
    .map((company) => ({ ...company, urls: [...company.urls].sort() }))
    .sort(
      (a, b) => a.name.localeCompare(b.name) || getCompanyKey(a).localeCompare(getCompanyKey(b))
    );

  await saveCompanies(result);

  logger.info({ count: result.length }, "💰 Successfully built companies");

  return result;
}
