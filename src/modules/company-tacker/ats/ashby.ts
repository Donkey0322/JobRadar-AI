import type { Company } from "../type";

import { isTechIntern, withinDays } from "../utils";

interface AshbyJob {
  title: string;
  location: string;
  jobUrl: string;
  publishedAt: string;
}

export function urlToAshbyCompany(url: URL): Company {
  const identifier = url.pathname.split("/")[1];
  return {
    name: identifier,
    ats: "ashby",
    identifier,
    domain: url.origin,
    page: `https://api.ashbyhq.com/posting-api/job-board/${identifier}`,
    urls: [],
  };
}

export async function fetchAshby(company: Company, urls: Set<string>) {
  try {
    const res = await fetch(company.page);
    if (!res.ok) {
      // console.log(company.name, res.status, res.statusText, res.url);
      return [];
    }
    const data = await res.json();

    const interns: AshbyJob[] = data.jobs.filter(
      (job: AshbyJob) =>
        isTechIntern(job.title) && !urls.has(job.jobUrl) && withinDays(job.publishedAt)
    );

    return interns.map((job) => ({
      company: company.name,
      role: job.title,
      link: job.jobUrl,
      location: job.location,
    }));
  } catch (error) {
    console.error(`Error fetching ashby jobs for ${company}: ${error}`);
    return [];
  }
}
