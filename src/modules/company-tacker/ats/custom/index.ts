// Amazon, Google, Apple, Meta, TikTok, Uber

import { RED_CROSS } from "@/constants/log";

import type { Company } from "@/modules/company-tacker/type";
import type { Job } from "@/types";

import { ATSFetcher } from "../class";

import { AmazonCompany, fetchAmazon } from "./amazon";
import { AMDCompany, fetchAMD } from "./amd";
import { AppleCompany, fetchApple } from "./apple";
import { fetchGoogle, GoogleCompany } from "./google";
import { fetchMeta, MetaCompany } from "./meta";
import { fetchNetflix, NetflixCompany } from "./netflix";
import { fetchTikTok, TikTokCompany } from "./tiktok";

import { logger } from "@/utils/logger";

type CustomCompanyIdentifier =
  | "amazon"
  | "google"
  | "meta"
  | "apple"
  | "netflix"
  | "tiktok"
  | "amd";

export const CUSTOM_COMPANY_DOMAINS = {
  amazon: "amazon.jobs",
  google: "google.com",
  meta: "metacareers.com",
  apple: "jobs.apple.com",
  netflix: "netflix.net",
  tiktok: "tiktok.com",
  amd: "amd.com",
} satisfies Record<CustomCompanyIdentifier, string>;

export function parseCustomCompanyIdentifier(url: URL): CustomCompanyIdentifier | null {
  const host = url.hostname;

  for (const [identifier, domain] of Object.entries(CUSTOM_COMPANY_DOMAINS)) {
    if (host.endsWith(domain)) {
      return identifier as CustomCompanyIdentifier;
    }
  }

  return null;
}

export class CustomFetcher extends ATSFetcher<Job> {
  readonly ats = "custom" as const;

  formCompany(url: URL): Company {
    const host = url.hostname;
    const identifier = parseCustomCompanyIdentifier(url);

    switch (identifier) {
      case "amazon":
        return AmazonCompany;
      case "google":
        return GoogleCompany;
      case "meta":
        return MetaCompany;
      case "apple":
        return AppleCompany;
      case "netflix":
        return NetflixCompany;
      case "tiktok":
        return TikTokCompany;
      case "amd":
        return AMDCompany;
      default: {
        identifier satisfies null;
        return {
          name: host.replace("www.", ""),
          ats: "custom",
          identifier: host.replace("www.", ""),
          domain: url.origin,
          page: ``,
          urls: [],
        };
      }
    }
  }

  protected getJobsFromResponse(data: unknown): Job[] {
    if (!Array.isArray(data)) {
      return [];
    }

    return data.filter(
      (job): job is Job =>
        typeof job === "object" &&
        job !== null &&
        typeof job.company === "string" &&
        typeof job.role === "string" &&
        typeof job.link === "string" &&
        typeof job.location === "string"
    );
  }

  protected getJobLink(job: Job, _company: Company): string {
    void _company;
    return job.link;
  }

  protected normalizeJob(job: Job, _company: Company): Job {
    void _company;
    return job;
  }

  async fetch(company: Company, urls: Set<string>, signal: AbortSignal): Promise<Job[]> {
    if (company.page === "") {
      // logger.warn({ company: company.name }, `⚠️ No page specified`);
      return [];
    }

    try {
      const identifier = parseCustomCompanyIdentifier(new URL(company.page));

      switch (identifier) {
        case "amazon": {
          return await fetchAmazon(company, urls, signal);
        }
        case "google": {
          return await fetchGoogle(company, urls, signal);
        }
        case "meta": {
          return await fetchMeta(company, urls, signal);
        }
        case "apple": {
          return await fetchApple(company, urls, signal);
        }
        case "netflix": {
          return await fetchNetflix(company, urls, signal);
        }
        case "tiktok": {
          return await fetchTikTok(company, urls, signal);
        }
        case "amd": {
          return await fetchAMD(company, urls, signal);
        }
        default:
          identifier satisfies null;
          return [];
      }
    } catch (error) {
      logger.error(
        { err: error, company: company.name },
        `${RED_CROSS} Error fetching custom jobs`
      );
      return [];
    }
  }
}

export const customFetcher = new CustomFetcher();
