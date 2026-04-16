import type { AshbyJob } from "@/modules/company-tacker/ats/ashby";

import { ASHBY_API_URL } from "@/constants/ats";
import { logger } from "@/utils/logger";

export async function fetchAshbyJD(url: string) {
  const u = new URL(url);
  const identifier = u.pathname.split("/")[1];

  const id = u.pathname.split("/")[2];

  const apiUrl = `${ASHBY_API_URL}/${identifier}`;

  try {
    const res = await fetch(apiUrl);
    if (!res.ok) {
      logger.error({ apiUrl, statusText: res.statusText }, "❌ Failed to fetch ashby JD");
      return null;
    }

    const data: { jobs: AshbyJob[] } = await res.json();
    const jd = data.jobs.find((job: AshbyJob) => job.id === id) ?? null;
    if (!jd) return null;
    return JSON.stringify(jd);
  } catch (error) {
    logger.error({ err: error, apiUrl }, "❌ Error fetching ashby JD");
    return null;
  }
}
