import type { Company } from "../type";

import { isTarget, withinDays } from "../utils";

interface LeverJob {
  company_name: string;
  text: string;
  hostedUrl: string;
  createdAt: number;
  categories: {
    location?: string;
  };
}

export function urlToLeverCompany(url: URL): Company {
  const page = url.origin.includes("eu")
    ? "https://api.eu.lever.co/v0/postings/"
    : "https://api.lever.co/v0/postings/";
  const parts = url.pathname.split("/").filter(Boolean);
  const identifier = parts[0];

  return {
    name: identifier,
    ats: "lever",
    identifier,
    domain: url.origin,
    page: `${page}${identifier}?mode=json`,
    urls: [],
  };
}

export async function fetchLever(company: Company, urls: Set<string>) {
  try {
    const res = await fetch(company.page);
    if (!res.ok) {
      // console.log(company.name, res.status, res.statusText, res.url);
      return [];
    }
    const data = await res.json();

    const interns: LeverJob[] = data.filter(
      (job: LeverJob) => isTarget(job.text) && !urls.has(job.hostedUrl) && withinDays(job.createdAt)
    );

    return interns.map((job: LeverJob) => ({
      company: job.company_name,
      role: job.text,
      link: job.hostedUrl,
      location: job.categories?.location ?? "",
    }));
  } catch (error) {
    console.error(`Error fetching lever jobs for ${company}: ${error}`);
    return [];
  }
}
