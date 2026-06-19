// Amazon, Microsoft, Google, Apple, Meta, TikTok, Uber

import {
  APPLE_CAREERS_URL,
  GOOGLE_CAREERS_URL,
  META_CAREERS_URL,
  NETFLIX_API_URL,
  TIKTOK_API_URL,
} from "@/constants/ats";

import type { Company } from "@/modules/company-tacker/type";
import type { Job } from "@/types";

import { fetchAmazon } from "./amazon";
import { fetchApple } from "./apple";
import { fetchGoogle } from "./google";
import { fetchMeta } from "./meta";
import { fetchMicrosoft } from "./microsoft";
import { fetchNetflix } from "./netflix";
import { fetchTikTok } from "./tiktok";

type CustomCompanyIdentifier =
  | "amazon"
  | "microsoft"
  | "google"
  | "meta"
  | "apple"
  | "netflix"
  | "tiktok";

const COMPANY_MATCHERS = {
  amazon: "amazon.jobs",
  microsoft: "microsoft.com",
  google: "google.com",
  meta: "metacareers.com",
  apple: "jobs.apple.com",
  netflix: "netflix.net",
  tiktok: "tiktok.com",
} satisfies Record<CustomCompanyIdentifier, string>;

export function parseCustomCompanyIdentifier(url: URL): CustomCompanyIdentifier | null {
  const host = url.hostname;

  for (const [identifier, domain] of Object.entries(COMPANY_MATCHERS)) {
    if (host.endsWith(domain)) {
      return identifier as CustomCompanyIdentifier;
    }
  }

  return null;
}

export function urlToCustomCompany(url: URL): Company {
  const host = url.hostname;
  const identifier = parseCustomCompanyIdentifier(url);

  switch (identifier) {
    case "amazon":
      return {
        name: "Amazon",
        ats: "custom",
        identifier,
        domain: url.origin,
        page: "https://amazon.jobs/api/jobs/search?is_als=true",
        urls: [],
      };
    case "microsoft":
      return {
        name: "Microsoft",
        ats: "custom",
        identifier,
        domain: url.origin,
        page: "https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&query=&location=United%20States&start=0&sort_by=timestamp&filter_include_remote=1",
        urls: [],
      };
    case "google":
      return {
        name: "Google",
        ats: "custom",
        identifier,
        domain: url.origin,
        page: `${GOOGLE_CAREERS_URL}/jobs/results?&sort_by=date`,
        urls: [],
      };
    case "meta":
      return {
        name: "Meta",
        ats: "custom",
        identifier,
        domain: url.origin,
        page: META_CAREERS_URL,
        urls: [],
      };
    case "apple":
      return {
        name: "Apple",
        ats: "custom",
        identifier,
        domain: url.origin,
        page: APPLE_CAREERS_URL,
        urls: [],
      };
    case "netflix":
      return {
        name: "Netflix",
        ats: "custom",
        identifier,
        domain: url.origin,
        page: NETFLIX_API_URL,
        urls: [],
      };
    case "tiktok":
      return {
        name: "TikTok",
        ats: "custom",
        identifier,
        domain: url.origin,
        page: TIKTOK_API_URL,
        urls: [],
      };
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

export async function fetchCustom(
  company: Company,
  urls: Set<string>,
  signal: AbortSignal
): Promise<Job[]> {
  const identifier = parseCustomCompanyIdentifier(new URL(company.page));

  switch (identifier) {
    case "microsoft": {
      return await fetchMicrosoft(company, urls, signal);
    }
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
    default:
      identifier satisfies null;
      return [];
  }
}
