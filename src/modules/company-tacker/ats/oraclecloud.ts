import { RED_CROSS } from "@/constants/log";

import type { Company } from "../type";

import { isTarget, withinDays } from "../utils";

import { appendErrorLog } from "@/utils/data";
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

export async function fetchOracleCloud(company: Company, urls: Set<string>, signal: AbortSignal) {
  try {
    const res = await fetch(company.page, {
      signal,
    });

    if (!res.ok) {
      await appendErrorLog(`Oracle Cloud: ${company.name} - ${res.status} - ${res.statusText}`);
      return [];
    }

    const data = await res.json();

    if (!data?.items || !Array.isArray(data.items) || data.items.length === 0) {
      logger.warn(
        {
          company: company.name,
        },
        "⚠️ Oracle Cloud missing items"
      );

      return [];
    }

    let companyName: string = company.name;

    const firstItem = data.items[0];
    const organization = firstItem?.organizationsFacet;

    if (organization?.length > 0) {
      const organizationName = organization.find(
        (organization: { Id: number }) => organization.Id === 1
      )?.Name;
      if (organizationName) {
        companyName = organizationName;
      } else {
        companyName = organization[0]?.Name;
      }
    }

    const requisitionList = firstItem?.requisitionList;

    if (!Array.isArray(requisitionList)) {
      logger.warn(
        {
          company: company.name,
        },
        "⚠️ Oracle Cloud missing requisition list"
      );

      return [];
    }

    const jobs: OracleCloudJob[] = requisitionList.filter(
      (job: OracleCloudJob) =>
        job?.Title &&
        job?.Id &&
        isTarget(job.Title) &&
        !urls.has(composeUrl(company, job.Id)) &&
        withinDays(job.PostedDate)
    );

    return jobs.map((job) => ({
      company: capitalize(companyName),
      role: job.Title,
      link: composeUrl(company, job.Id),
      location: job.PrimaryLocation ?? "",
    }));
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      logger.warn(
        {
          company: company.name,
          url: company.page,
        },
        "⚠️ Oracle Cloud request aborted"
      );

      return [];
    }

    logger.error(
      {
        error,
        company: company.name,
        url: company.page,
      },
      `${RED_CROSS} Error fetching oracle cloud jobs`
    );

    return [];
  }
}
