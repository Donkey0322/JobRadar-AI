import type { Company } from "../../type";
import type { Job } from "@/types";

import { isTarget, withinDays } from "@/modules/company-tacker/utils";

interface MicrosoftJob {
  name: string;
  url: string;
  location: string[];
  creationTs: number;
  postedTs: number;
}

export async function fetchMicrosoft(company: Company, urls: Set<string>): Promise<Job[]> {
  const res = await fetch(company.page);
  const data = await res.json();

  const jobs: MicrosoftJob[] = data?.data?.positions.filter(
    (job: MicrosoftJob) =>
      isTarget(job.name) &&
      !urls.has(`${company.domain}/${job.url}`) &&
      (withinDays(job.creationTs * 1000) || withinDays(job.postedTs * 1000))
  );

  return jobs.map((job) => ({
    company: company.name,
    role: job.name,
    link: `${company.domain}/${job.url}`,
    location: job.location?.[0] ?? "",
  }));
}
