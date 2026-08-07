import pLimit from "p-limit";
import { URL } from "url";

import type { Company } from "./type";

import { classifyATS, getATSFetcher } from "./ats";

import { loadCompanies, saveCompanies } from "@/utils/data";
import { renderProgress } from "@/utils/dev";
import { logger } from "@/utils/logger";

const CONCURRENCY = 20;

function getCompanyKey(company: Company): string {
  if (company.identifier) {
    return `${company.ats}:${company.identifier}`;
  }

  return `${company.ats}:${company.domain}:${company.page}`;
}

function groupUrlsByCompanyKey(urls: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();

  for (const urlStr of urls) {
    let key: string;

    try {
      const url = new URL(urlStr);
      const ats = classifyATS(url);
      key = getATSFetcher(ats).companyKeyFromUrl(url);
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
    const company = await getATSFetcher(ats).formCompany(url);

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
  const total = groups.size;
  let completed = 0;

  const limit = pLimit(CONCURRENCY);

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
    if (!company) {
      continue;
    }

    const key = getCompanyKey(company);

    if (!map.has(key)) {
      map.set(key, company);
      continue;
    }

    map.get(key)!.urls.push(...company.urls);
  }

  // Merge existing companies so companies don't disappear
  const existingCompanies = await loadCompanies();

  for (const existingCompany of existingCompanies) {
    const key = getCompanyKey(existingCompany);

    if (!map.has(key)) {
      map.set(key, {
        ...existingCompany,
        urls: [],
      });
    }
  }

  const result = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));

  await saveCompanies(result);

  logger.info({ count: result.length }, "💰 Successfully built companies");

  return result;
}
