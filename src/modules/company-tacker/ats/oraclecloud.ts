import { RED_CROSS } from "@/constants/log";

import type { Company } from "../type";

import { isTarget, withinDays } from "../utils";

import { logger } from "@/utils/logger";
import { capitalize } from "@/utils/string";

interface OracleCloudJob {
  Id: string;
  Title: string;
  PostedDate: string;
  PrimaryLocation: string;
}

export function urlToOracleCloudCompany(url: URL): Company {
  const identifier = url.hostname.replace("www.", "");

  const parts = url.pathname.split("/");
  parts.pop();
  const path = parts.join("/");

  return {
    name: identifier,
    ats: "oraclecloud",
    identifier,
    domain: url.origin + path,
    page: `${url.origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.workLocation,requisitionList.otherWorkLocations,requisitionList.secondaryLocations,flexFieldsFacet.values,requisitionList.requisitionFlexFields&finder=findReqs;siteNumber=CX_1001,facetsList=LOCATIONS%3BWORK_LOCATIONS%3BWORKPLACE_TYPES%3BTITLES%3BCATEGORIES%3BORGANIZATIONS%3BPOSTING_DATES%3BFLEX_FIELDS,limit=25,sortBy=POSTING_DATES_DESC`,
    urls: [],
  };
}

const composeUrl = (company: Company, id: string) => {
  return `${company.domain}/${id}`;
};

export async function fetchOracleCloud(
  company: Company,
  urls: Set<string>,
  timeout: number = 5000
) {
  try {
    const res = await fetch(company.page, {
      signal: AbortSignal.timeout(timeout),
    });
    const data = await res.json();

    if (!res.ok || !data.items || !data.items.length) {
      return [];
    }

    const companyName: string =
      data.items?.[0]?.organizationsFacet.length > 0
        ? data.items?.[0]?.organizationsFacet[0].Name
        : "";

    const jobs: OracleCloudJob[] = data.items?.[0]?.requisitionList?.filter(
      (job: OracleCloudJob) =>
        isTarget(job.Title) && !urls.has(composeUrl(company, job.Id)) && withinDays(job.PostedDate)
    );

    return jobs.map((job) => ({
      company: capitalize(companyName),
      role: job.Title,
      link: composeUrl(company, job.Id),
      location: job.PrimaryLocation,
    }));
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      logger.error(
        { err: "TimeoutError", company: company.name, url: company.page },
        `${RED_CROSS} Error fetching oracle cloud jobs`
      );
      return [];
    }

    logger.error(
      { err: error, company: company.name },
      `${RED_CROSS} Error fetching oracle cloud jobs`
    );
    return [];
  }
}
