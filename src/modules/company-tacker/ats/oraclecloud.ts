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

const identifierMap: Record<string, string> = {
  "fa-ewgu-saasfaprod1.fa.ocs.oraclecloud.com": "Chubb",
};

export async function getSiteSettings(url: URL) {
  const parts = url.pathname.split("/").filter(Boolean);

  const candidateExperienceIndex = parts.indexOf("CandidateExperience");
  const sitesIndex = parts.indexOf("sites");

  if (candidateExperienceIndex === -1 || sitesIndex === -1) {
    throw new Error("Invalid Oracle CandidateExperience job URL");
  }

  const lang = parts[candidateExperienceIndex + 1];
  const siteNumber = parts[sitesIndex + 1];

  if (!lang || !siteNumber) {
    throw new Error("Missing language or site number");
  }

  const apiUrl = `${url.origin}/hcmRestApi/CandidateExperience/${lang}/siteSettings/${siteNumber}`;

  try {
    const res = await fetch(apiUrl);
    const data = await res.json();
    return { companyName: data.app.siteName as string, siteNumber };
  } catch {
    return {
      companyName: identifierMap[url.hostname] ?? (url.hostname.replace("www.", "") as string),
      siteNumber,
    };
  }
}

export async function urlToOracleCloudCompany(url: URL): Promise<Company> {
  const { companyName, siteNumber } = await getSiteSettings(url);
  const identifier = url.hostname.replace("www.", "");

  const parts = url.pathname.split("/");
  parts.pop();
  const path = parts.join("/");

  const page = new URL(`${url.origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitions`);

  page.searchParams.set("onlyData", "true");

  page.searchParams.set(
    "finder",
    [`findReqs;siteNumber=${siteNumber}`, "limit=25", "sortBy=POSTING_DATES_DESC"].join(",")
  );

  page.searchParams.set(
    "expand",
    ["requisitionList.secondaryLocations", "requisitionList.otherWorkLocations"].join(",")
  );

  return {
    name: companyName,
    ats: "oraclecloud",
    identifier,
    domain: url.origin + path,
    page: page.href,
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

    const firstItem = data.items[0];

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
      company: capitalize(company.name),
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
