import z from "zod";

import { RED_CROSS } from "@/constants/log";

import type { Company } from "../type";
import type { Job } from "@/types";

import { isTarget, withinDays } from "../utils";

import { ATSFetcher } from "./class";

import { appendErrorLog } from "@/utils/data";
import { logger } from "@/utils/logger";
import { capitalize } from "@/utils/string";

export const OracleCloudJobSchema = z.object({
  Id: z.string(),
  Title: z.string(),
  PostedDate: z.string(),
  PrimaryLocation: z.string().optional(),
});

export type OracleCloudJob = z.infer<typeof OracleCloudJobSchema>;

export const OracleCloudResponseSchema = z.object({
  items: z.array(
    z.object({
      requisitionList: z.array(OracleCloudJobSchema),
    })
  ),
});

const identifierMap: Record<string, string> = {
  "fa-ewgu-saasfaprod1.fa.ocs.oraclecloud.com": "Chubb",
  "ekaw.fa.us2.oraclecloud.com": "Securitas",
  "fa-evmr-saasfaprod1.fa.ocs.oraclecloud.com": "Nokia",
  "fa-eups-saasfaprod1.fa.ocs.oraclecloud.com": "Ul solutions",
  "hcjy.fa.us2.oraclecloud.com": "CooperSurgical",
  "ecnf.fa.us2.oraclecloud.com": "Tradeweb",
  "ibqbjb.fa.ocs.oraclecloud.com": "Honeywell",
  "ecge.fa.us2.oraclecloud.com": "Blue Shield",
  "edel.fa.us2.oraclecloud.com": "Fortinet",
  "fa-euxc-saasfaprod1.fa.ocs.oraclecloud.com": "Citco",
  "hccz.fa.em3.oraclecloud.com": "Pearson",
  "fa-eygo-saasfaprod1.fa.ocs.oraclecloud.com": "Worthington",
  "ejhp.fa.us6.oraclecloud.com": "Sherwin-Williams",
  "erqh.fa.us2.oraclecloud.com": "Atlantic Health",
  "edix.fa.us2.oraclecloud.com": "CORSAIR",
  "ebwb.fa.us2.oraclecloud.com": "HOLOGIC",
  "eofe.fa.us2.oraclecloud.com": "BNY",
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

const composeUrl = (company: Company, id: string) => {
  return `${company.domain}/${id}`;
};

export class OracleCloudFetcher extends ATSFetcher<OracleCloudJob> {
  readonly ats = "oraclecloud" as const;

  async formCompany(url: URL): Promise<Company> {
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
      ats: this.ats,
      identifier,
      domain: url.origin + path,
      page: page.href,
      urls: [],
    };
  }

  protected getJobsFromResponse(data: unknown): OracleCloudJob[] {
    const parsed = OracleCloudResponseSchema.safeParse(data);

    if (!parsed.success) {
      logger.error(
        { data, issues: parsed.error.issues },
        `${RED_CROSS} Invalid Oracle Cloud response`
      );

      return [];
    }

    return parsed.data.items[0]?.requisitionList ?? [];
  }

  protected getJobLink(job: OracleCloudJob, company: Company): string {
    return composeUrl(company, job.Id);
  }

  protected normalizeJob(job: OracleCloudJob, company: Company): Job {
    return {
      company: capitalize(company.name),
      role: job.Title,
      link: this.getJobLink(job, company),
      location: job.PrimaryLocation ?? "",
    };
  }

  async fetch(company: Company, urls: Set<string>, signal: AbortSignal): Promise<Job[]> {
    try {
      const res = await fetch(company.page, {
        signal,
      });

      if (!res.ok) {
        await appendErrorLog(`Oracle Cloud: ${company.name} - ${res.status} - ${res.statusText}`);
        return [];
      }

      const rawJobs = this.getJobsFromResponse(await res.json());

      const opportunities = rawJobs
        .filter(
          (job) =>
            isTarget(job.Title) &&
            !urls.has(this.getJobLink(job, company)) &&
            withinDays(job.PostedDate)
        )
        .map((job) => this.normalizeJob(job, company));

      return opportunities;
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
}

export const oracleCloudFetcher = new OracleCloudFetcher();
