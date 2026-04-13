import type { Company } from "../type";

import { isTarget, withinDays } from "../utils";

import { SMART_RECRUITERS_API_URL } from "@/constants/ats";

interface SmartRecruitersJob {
  id: string;
  name: string;
  company: {
    name: string;
  };
  releasedDate: string;
  location: {
    fullLocation: string;
  };
}

export function urlToSmartRecruitersCompany(url: URL): Company {
  const parts = url.pathname.split("/").filter(Boolean);
  const identifier = parts[0];

  return {
    name: identifier,
    ats: "smartrecruiters",
    identifier,
    domain: url.origin,
    page: `${SMART_RECRUITERS_API_URL}/${identifier}/postings`,
    urls: [],
  };
}

export async function fetchSmartRecruiters(company: Company, urls: Set<string>) {
  try {
    const res = await fetch(company.page);
    const data = await res.json();

    if (!res.ok || !data.content) {
      // console.log(company.name, res.status, res.statusText, res.url);
      return [];
    }

    const interns: SmartRecruitersJob[] = data.content.filter(
      (job: SmartRecruitersJob) =>
        isTarget(job.name) &&
        !urls.has(`${company.domain}/${company.name}/${job.id}`) &&
        withinDays(job.releasedDate)
    );

    return interns.map((job) => ({
      company: job.company.name ?? "",
      role: job.name,
      link: `${company.domain}/${company.name}/${job.id}`,
      location: job.location.fullLocation ?? "",
    }));
  } catch (error) {
    console.error(`Error fetching greenhouse jobs for ${company}: ${error}`);
    return [];
  }
}
