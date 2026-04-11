import type { Company } from "../type";

import { isTechIntern, withinDays } from "../utils";

interface GreenhouseJob {
  company_name: string;
  title: string;
  absolute_url: string;
  first_published: string;
  updated_at: string;
  location?: {
    name: string;
  };
}

export function urlToGreenhouseCompany(url: URL): Company {
  const parts = url.pathname.split("/").filter(Boolean);
  const identifier = parts[0];
  const host = url.hostname;

  // embed
  if (!host.endsWith("greenhouse.io")) {
    const identifier = host.replace("www.", "").split(".")[0] ?? "";
    return {
      name: identifier,
      ats: "greenhouse",
      identifier,
      domain: url.origin,
      page: `https://boards-api.greenhouse.io/v1/boards/${identifier}/jobs`,
      urls: [],
    };
  }

  return {
    name: identifier,
    ats: "greenhouse",
    identifier,
    domain: url.origin,
    page: `https://boards-api.greenhouse.io/v1/boards/${identifier}/jobs`,
    urls: [],
  };
}

export async function fetchGreenhouse(company: Company, urls: Set<string>) {
  try {
    const res = await fetch(company.page);
    const data = await res.json();

    if (!res.ok || !data.jobs) {
      // console.log(company.name, res.status, res.statusText, res.url);
      return [];
    }

    const interns: GreenhouseJob[] = data.jobs.filter(
      (job: GreenhouseJob) =>
        isTechIntern(job.title) &&
        !urls.has(job.absolute_url) &&
        (withinDays(job.first_published) || withinDays(job.updated_at))
    );

    return interns.map((job) => ({
      company: job.company_name,
      role: job.title,
      link: job.absolute_url,
      location: job.location?.name ?? "",
    }));
  } catch (error) {
    console.error(`Error fetching greenhouse jobs for ${company}: ${error}`);
    return [];
  }
}
