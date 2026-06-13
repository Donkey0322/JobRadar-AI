// Amazon, Microsoft, Google, Apple, Meta, TikTok, Uber

import type { Company } from "@/modules/company-tacker/type";
import type { Job } from "@/types";

import { fetchAmazon } from "./amazon";
import { fetchGoogle } from "./google";
import { fetchMeta } from "./meta";
import { fetchMicrosoft } from "./microsoft";

type CustomCompanyIdentifier = "amazon" | "microsoft" | "google" | "meta";

function parseCustomCompanyIdentifier(url: URL): CustomCompanyIdentifier | null {
  const host = url.hostname;
  if (host.includes("amazon.jobs")) {
    return "amazon";
  } else if (host.includes("microsoft.com")) {
    return "microsoft";
  } else if (host.includes("google.com")) {
    return "google";
  } else if (host.includes("metacareers.com")) {
    return "meta";
  } else {
    // logger.warn(`Unsupported custom company: ${host}`);
    return null;
  }
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
        page: "https://www.google.com/about/careers/applications/jobs/results?location=United%20States&sort_by=date&target_level=INTERN_AND_APPRENTICE&target_level=EARLY",
        urls: [],
      };
    case "meta":
      return {
        name: "Meta",
        ats: "custom",
        identifier,
        domain: url.origin,
        page: "https://www.metacareers.com/jobsearch",
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
  switch (company.identifier) {
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
    default:
      return [];
  }
}
