import { promises as fs } from "fs";
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

import { logger } from "@/utils/logger";

function extractCompany(urlStr: string): Company | null {
  try {
    const url = new URL(urlStr);
    const ats = classifyATS(url);

    switch (ats) {
      case "greenhouse":
        return urlToGreenhouseCompany(url);
      case "lever":
        return urlToLeverCompany(url);
      case "workday":
        return urlToWorkdayCompany(url);
      case "ashby":
        return urlToAshbyCompany(url);
      case "smartrecruiters":
        return urlToSmartRecruitersCompany(url);
      case "icims":
        return urlToIcimsCompany(url);
      case "oraclecloud":
        return urlToOracleCloudCompany(url);
      case "custom":
        return urlToCustomCompany(url);
      default:
        ats satisfies never;
        return null;
    }
  } catch {
    return null;
  }
}

export async function buildCompanyList(urls: string[] | Set<string>): Promise<Company[]> {
  const map = new Map<string, Company>();

  for (const url of urls) {
    const company = extractCompany(url);
    if (!company) continue;

    const key = `${company.ats}:${company.identifier}`;

    if (!map.has(key)) {
      company.urls.push(url);
      map.set(key, company);
    } else {
      map.get(key)!.urls.push(url);
    }
  }

  const result = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));

  await fs.writeFile(COMPANY_PATH, JSON.stringify(result, null, 2), "utf-8");

  logger.info({ count: result.length }, `💰 Successfully built companies`);

  return result;
}
