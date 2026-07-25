// Amazon, Google, Apple, Meta, TikTok, Uber

import { RED_CROSS } from "@/constants/log";

import type { Company } from "@/modules/company-tacker/type";
import type { Job } from "@/types";

import { ATSFetcher } from "../class";

import { AmazonCompany, fetchAmazon } from "./amazon";
import { AMDCompany, fetchAMD } from "./amd";
import { AppleCompany, fetchApple } from "./apple";
import { fetchGoogle, GoogleCompany } from "./google";
import { parseCustomCompanyIdentifier } from "./identifier";
import { fetchMeta, MetaCompany } from "./meta";
import { fetchNetflix, NetflixCompany } from "./netflix";
import { fetchTikTok, TikTokCompany } from "./tiktok";

import { logger } from "@/utils/logger";

export {
  CUSTOM_COMPANY_DOMAINS,
  parseCustomCompanyIdentifier,
  type CustomCompanyIdentifier,
} from "./identifier";

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

  async fetch(
    company: Company,
    knownKeys: ReadonlySet<string>,
    signal: AbortSignal
  ): Promise<Job[]> {
    if (company.page === "") {
      // logger.warn({ company: company.name }, `⚠️ No page specified`);
      return [];
    }

    try {
      const identifier = parseCustomCompanyIdentifier(new URL(company.page));

      switch (identifier) {
        case "amazon": {
          return await fetchAmazon(company, knownKeys, signal);
        }
        case "google": {
          return await fetchGoogle(company, knownKeys, signal);
        }
        case "meta": {
          return await fetchMeta(company, knownKeys, signal);
        }
        case "apple": {
          return await fetchApple(company, knownKeys, signal);
        }
        case "netflix": {
          return await fetchNetflix(company, knownKeys, signal);
        }
        case "tiktok": {
          return await fetchTikTok(company, knownKeys, signal);
        }
        case "amd": {
          return await fetchAMD(company, knownKeys, signal);
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
