import { promises as fs } from "fs";
import pLimit from "p-limit";
import { URL } from "url";

import { COMPANY_PATH } from "@/constants";

import type { Company } from "./type";

import { urlToAshbyCompany } from "./ats/ashby";
import { urlToCustomCompany } from "./ats/custom";
import { urlToGreenhouseCompany } from "./ats/greenhouse";
import { urlToIcimsCompany } from "./ats/icims";
import { urlToLeverCompany } from "./ats/lever";
import { urlToOracleCloudCompany } from "./ats/oraclecloud";
import { urlToSmartRecruitersCompany } from "./ats/smart";
import { urlToWorkdayCompany } from "./ats/workday";
import { classifyATS } from "./ats";

import { loadCompanies } from "@/utils/data";
import { renderProgress } from "@/utils/dev";
import { logger } from "@/utils/logger";

const CONCURRENCY = 20;

async function extractCompany(urlStr: string): Promise<Company | null> {
  try {
    const url = new URL(urlStr);
    const ats = classifyATS(url);

    switch (ats) {
      case "greenhouse":
        return await urlToGreenhouseCompany(url);
      case "lever":
        return urlToLeverCompany(url);
      case "workday":
        return urlToWorkdayCompany(url);
      case "ashby":
        return await urlToAshbyCompany(url);
      case "smartrecruiters":
        return urlToSmartRecruitersCompany(url);
      case "icims":
        return urlToIcimsCompany(url);
      case "oraclecloud":
        return await urlToOracleCloudCompany(url);
      case "custom":
        return urlToCustomCompany(url);
      default:
        ats satisfies never;
        return null;
    }
  } catch (err) {
    logger.warn(
      {
        url: urlStr,
        err,
      },
      "Failed to extract company from URL"
    );

    return null;
  }
}

function getCompanyKey(company: Company): string {
  if (company.identifier) {
    return `${company.ats}:${company.identifier}`;
  }

  return `${company.ats}:${company.domain}:${company.page}`;
}

export async function buildCompanyList(urls: string[] | Set<string>): Promise<Company[]> {
  const map = new Map<string, Company>();

  const urlList = Array.from(urls);
  const total = urlList.length;

  let completed = 0;

  const limit = pLimit(CONCURRENCY);

  const results = await Promise.all(
    urlList.map((url) =>
      limit(async () => {
        const company = await extractCompany(url);

        completed++;
        renderProgress(completed, total);

        return {
          url,
          company,
        };
      })
    )
  );

  // Build latest company snapshot from URLs
  for (const { url, company } of results) {
    if (!company) {
      continue;
    }

    const key = getCompanyKey(company);

    if (!map.has(key)) {
      company.urls.push(url);
      map.set(key, company);
      continue;
    }

    map.get(key)!.urls.push(url);
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

  await fs.writeFile(COMPANY_PATH, JSON.stringify(result, null, 2), "utf-8");

  logger.info({ count: result.length }, "💰 Successfully built companies");

  return result;
}
