import { promises as fs } from "fs";
import { URL } from "url";

import type { Company } from "./type";

import { urlToAshbyCompany } from "./ats/ashby";
import { urlToCustomCompany } from "./ats/custom";
import { urlToGreenhouseCompany } from "./ats/greenhouse";
import { urlToLeverCompany } from "./ats/lever";
import { urlToWorkdayCompany } from "./ats/workday";

import { COMPANY_PATH } from "@/constants";

function extractCompany(urlStr: string): Company | null {
  try {
    const url = new URL(urlStr);
    const host = url.hostname;

    if (host.includes("greenhouse.io")) {
      return urlToGreenhouseCompany(url);
    } else if (host.endsWith("lever.co")) {
      return urlToLeverCompany(url);
    } else if (host.includes("workdayjobs.com")) {
      return urlToWorkdayCompany(url);
    } else if (host.includes("ashbyhq.com")) {
      return urlToAshbyCompany(url);
    } else {
      return urlToCustomCompany(url);
    }
  } catch {
    return null;
  }
}

export async function buildCompanyList(urls: string[]): Promise<Company[]> {
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

  const result = Array.from(map.values());

  // const count = result.reduce((acc, company) => acc + (company.ats !== "custom" ? 1 : 0), 0);
  // console.log(`🎉 Built ${count} companies`);

  await fs.writeFile(COMPANY_PATH, JSON.stringify(result, null, 2), "utf-8");

  return result;
}
