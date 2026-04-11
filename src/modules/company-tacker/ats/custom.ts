// 大廠通常有自己的 ATS，我們需要從他們的官網上抓取職位資訊
// Amazon, Microsoft, Google, Apple, Meta, TikTok, Uber

import type { Company } from "../type";

import { isTarget } from "../utils";
import { withinDays } from "../utils";

interface MicrosoftJob {
  name: string;
  url: string;
  location: string[];
  creationTs: number;
  postedTs: number;
}

interface AmazonJob {
  title: string[];
  url: string;
  location: string[];
  createdDate: number[];
  updatedDate: number[];
  icimsJobId: string[];
}

export function urlToCustomCompany(url: URL): Company {
  const host = url.hostname;

  if (host.includes("amazon.jobs")) {
    return {
      name: "Amazon",
      ats: "custom",
      identifier: "amazon",
      domain: url.origin,
      page: "https://amazon.jobs/api/jobs/search?is_als=true",
      urls: [],
    };
  } else if (host.includes("microsoft.com")) {
    return {
      name: "Microsoft",
      ats: "custom",
      identifier: "microsoft",
      domain: url.origin,
      page: "https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&query=&location=United%20States&start=0&sort_by=timestamp&filter_include_remote=1",
      urls: [],
    };
  } else {
    const identifier = host.replace("www.", "");
    return {
      name: identifier,
      ats: "custom",
      identifier,
      domain: url.origin,
      page: ``,
      urls: [],
    };
  }
}

export async function fetchCustom(company: Company, urls: Set<string>) {
  switch (company.identifier) {
    case "microsoft": {
      const res = await fetch(company.page);
      const data = await res.json();

      const interns: MicrosoftJob[] = data?.data?.positions.filter(
        (job: MicrosoftJob) =>
          isTarget(job.name) &&
          !urls.has(`${company.domain}/${job.url}`) &&
          (withinDays(job.creationTs * 1000) || withinDays(job.postedTs * 1000))
      );

      return interns.map((job) => ({
        company: company.name,
        role: job.name,
        link: `${company.domain}/${job.url}`,
        location: job.location?.[0] ?? "",
      }));
    }
    case "amazon": {
      const res = await fetch(company.page, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contentFilterFacets: [
            {
              name: "primarySearchLabel",
              values: [{ name: "studentprograms.team-internships-for-students" }],
            },
          ],
          locationFacets: [[{ name: "country", values: [{ name: "US" }] }]],
          size: 100,
          start: 0,
          sort: { sortOrder: "DESCENDING", sortType: "CREATED_DATE" },
        }),
      });

      const data = await res.json();
      const interns: AmazonJob[] = data.searchHits
        .map(({ fields }: { fields: AmazonJob }) => fields)
        .filter(
          (job: AmazonJob) =>
            isTarget(job.title?.[0] ?? "") &&
            !urls.has(`https://amazon.jobs/en/jobs/${job.icimsJobId?.[0]}`) &&
            (withinDays(job.createdDate?.[0] * 1000) || withinDays(job.updatedDate?.[0] * 1000))
        );
      return interns.map((job) => ({
        company: company.name,
        role: job.title?.[0] ?? "",
        link: `https://amazon.jobs/en/jobs/${job.icimsJobId?.[0]}`,
        location: job.location?.[0] ?? "",
      }));
    }
    default:
      return [];
  }
}
