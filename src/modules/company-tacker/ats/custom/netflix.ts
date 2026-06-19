import type { Company } from "@/modules/company-tacker/type";
import type { Job } from "@/types";

import { isTarget } from "../../utils";

interface NetflixJob {
  id: string;
  posting_name: string;
  location: string;
  canonicalPositionUrl: string;
}

interface NetflixResponse {
  positions: NetflixJob[];
}

const PAGE_SIZE = 10;
const MAX_PAGES = 10;

export async function fetchNetflix(
  company: Company,
  urls: Set<string>,
  signal: AbortSignal
): Promise<Job[]> {
  const allJobs: Job[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(company.page);

    url.searchParams.set("sort_by", "new");
    url.searchParams.set("num", String(PAGE_SIZE));

    if (page > 0) {
      url.searchParams.set("start", String(page * PAGE_SIZE));
    }

    const res = await fetch(url.toString(), {
      signal,
      headers: {
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      break;
    }

    const data = (await res.json()) as NetflixResponse;

    const positions = data.positions ?? [];

    if (positions.length === 0) {
      break;
    }

    const pageJobs: Job[] = positions.map((job) => ({
      company: "Netflix",
      role: job.posting_name,
      location: job.location,
      link: job.canonicalPositionUrl,
    }));

    allJobs.push(...pageJobs);
  }

  return allJobs.filter((job) => isTarget(job.role) && !urls.has(job.link));
}
